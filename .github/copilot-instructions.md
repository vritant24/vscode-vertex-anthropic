# Copilot instructions: vscode-vertex-anthropic

VS Code extension that registers a `vscode.lm` Language Model Chat Provider (vendor `vertex-anthropic`) exposing Anthropic Claude models running on Google Vertex AI. It is a thin adapter over the official `@anthropic-ai/vertex-sdk`.

## Architecture

Activation flow: `extension.ts` → builds an `AuthProvider` + `VertexAnthropicChatProvider`, registers it via `vscode.lm.registerLanguageModelChatProvider('vertex-anthropic', provider)`.

| File | Responsibility |
| --- | --- |
| `src/extension.ts` | `activate`/`deactivate`, command + config-change wiring. The only place that imports `vscode` for side effects. |
| `src/provider.ts` | Implements `LanguageModelChatProvider`: `provideLanguageModelChatInformation`, `provideLanguageModelChatResponse`, `provideTokenCount`. Reads live settings per request. |
| `src/auth.ts` | `AuthProvider` — mints + caches GCP Bearer tokens (`gcloud` ADC or service-account JWT). In-memory only. **No `vscode` import.** |
| `src/messages.ts` | Converts VS Code chat messages/tools ↔ Anthropic Messages API shapes. **No runtime `vscode` import** (uses `import type` + value classes only). |
| `src/stream.ts` | Async generator: Anthropic SSE events → `LanguageModelResponsePart`s. |
| `src/models.ts` | Static Claude-on-Vertex catalog + `getEffectiveCatalog` (merges user overrides) + `toChatInformation`. |
| `src/logger.ts` | `vscode`-free logging abstraction (`Log` interface + level filtering). |

## Critical conventions

- **Keep `auth.ts`, `messages.ts`, `stream.ts`, `logger.ts`, `models.ts` free of runtime `vscode` imports.** Tests mock `vscode` via a Vitest alias (`src/test/__mocks__/vscode.ts`); importing real `vscode` at runtime breaks them. Use `import type` for type-only needs.
- **Settings are top-level `vertexAnthropic.*`**, read via `workspace.getConfiguration` — NOT via the provider `configuration` contribution (the finalized `provideLanguageModelChatInformation` only receives `{ silent }`).
- **Model id lives in the URL path; `anthropic_version` in the body** — both handled by the SDK. Never add `model` to the request body manually.
- **Bearer tokens are in-memory only.** Never write them to `secrets`, disk, or logs.
- **No telemetry / no third-party servers.** The extension talks only to the user's GCP project.
- Anthropic requires the conversation to end with a `user` turn and consecutive same-role messages merged — `convertMessages` enforces both; preserve this if editing.
- The stable response API has no thinking part: `thinking_delta` is logged, not surfaced.

## Versioning gotcha

`engines.vscode`, `@types/vscode`, and the API surface must stay aligned. `@types/vscode` must be **≤** `engines.vscode` or `vsce package` fails. The provider API + `LanguageModelDataPart` require **≥ 1.106**.

## Changelog convention

- For any user-visible change (features, fixes, behavior changes, deprecations, or removals), update `CHANGELOG.md` in the same PR.
- Follow **Keep a Changelog** style sections (`Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, `Security`).
- During normal development, add entries under `Unreleased`.
- When cutting a release, move `Unreleased` entries to a versioned heading in the form `## [x.y.z] - YYYY-MM-DD` and keep wording concise and user-facing.
- Internal-only refactors with no user impact should not add noisy changelog entries.

## Workflow

```bash
npm run compile   # tsc --noEmit typecheck
npm run lint      # eslint src
npm test          # vitest run (unit tests, no editor needed)
npm run build     # esbuild bundle → dist/extension.js
npm run package   # vsce package → .vsix
```

Always run `compile`, `lint`, `test`, and `build` before considering a change done. Press `F5` for an Extension Development Host. When changing message/stream conversion, add or update the matching test in `src/test/`.
