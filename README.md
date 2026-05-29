# Anthropic on Vertex AI for VS Code

Use Anthropic Claude models running on Google Vertex AI from VS Code chat — including Copilot Chat and any other extension that consumes `vscode.lm`. Addresses [microsoft/vscode#318967](https://github.com/microsoft/vscode/issues/318967).

VS Code's built-in BYOK "Custom Endpoint" provider (`apiType: "messages"`) is incompatible with Vertex AI's Anthropic endpoints, which differ from the native Anthropic API: the model id lives in the URL path, `anthropic_version` goes in the request body, and auth uses GCP IAM Bearer tokens. This extension is a thin adapter over the official [`@anthropic-ai/vertex-sdk`](https://www.npmjs.com/package/@anthropic-ai/vertex-sdk), which handles those deltas.

## Setup

1. **Install the Google Cloud SDK** and authenticate:
   ```bash
   gcloud auth application-default login
   ```
2. Enable the Vertex AI API on your GCP project and ensure the Anthropic Claude models are enabled in [Vertex AI Model Garden](https://console.cloud.google.com/vertex-ai/model-garden).
3. Install this extension.
4. Open VS Code settings → **Anthropic on Vertex AI**. Set:
   - **Project ID** (`vertexAnthropic.projectId`): your GCP project (e.g. `my-team-prod`).
   - **Region** (`vertexAnthropic.region`): `global` (recommended) or a specific region.
5. Open chat and pick a Claude model from the model picker.

Models only appear once a **Project ID** is set.

## Service account auth (alternative)

Set **Auth Mode** (`vertexAnthropic.authMode`) to `service-account` and **Service Account Key Path** (`vertexAnthropic.serviceAccountKeyPath`) to a JSON keyfile path for a service account with the `roles/aiplatform.user` role.

## Settings

| Setting | Description |
| --- | --- |
| `vertexAnthropic.projectId` | GCP project ID. Required. |
| `vertexAnthropic.region` | Vertex AI region. Default `global`. |
| `vertexAnthropic.authMode` | `gcloud` (ADC) or `service-account`. |
| `vertexAnthropic.serviceAccountKeyPath` | Path to a service-account JSON key. |
| `vertexAnthropic.modelOverrides` | Override or extend the built-in model catalog. |
| `vertexAnthropic.logLevel` | `off` \| `error` \| `warn` \| `info` \| `debug` \| `trace`. |

## Commands

- **Vertex Anthropic: Refresh Models** — re-evaluate the available model list.
- **Vertex Anthropic: Clear Cached Token** — drop the in-memory Bearer token.

## Supported models

All Claude models offered on Vertex AI: Opus 4.x, Sonnet 4.x, Haiku 4.x. See [Anthropic's Vertex docs](https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai) for the live list. Add or override entries via `vertexAnthropic.modelOverrides`.

## Privacy

This extension talks directly to your GCP project. No telemetry, no third-party servers. Bearer tokens are kept in memory only — never written to disk or secret storage.

## Development

```bash
npm install
npm run lint     # eslint
npm test         # vitest unit tests
npm run build    # esbuild bundle → dist/extension.js
npm run package  # produce a .vsix
```

Press `F5` to launch an Extension Development Host.

## License

MIT
