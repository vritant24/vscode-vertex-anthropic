import type { LanguageModelChatInformation } from 'vscode';
import builtInModels from './models.catalog.json';

/** A Claude model offered on Vertex AI. */
export interface VertexClaudeModel {
	/** Vertex model ID (goes in the request URL path). */
	id: string;
	/** Display name. */
	name: string;
	/** Opaque model family, e.g. `claude`. */
	family: string;
	/** Opaque version string. */
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	vision: boolean;
	toolCalling: boolean;
	thinking?: boolean;
}

const BUILT_IN_MODELS = builtInModels as VertexClaudeModel[];

/**
 * Static catalog sourced from Anthropic's "Claude on Vertex AI" docs:
 * https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai
 *
 * Anthropic updates this page over time; users can override or extend it via
 * the `vertexAnthropic.modelOverrides` setting.
 */
export const VERTEX_CLAUDE_MODELS: VertexClaudeModel[] = [
	...BUILT_IN_MODELS
];

/** Partial override entry from the `vertexAnthropic.modelOverrides` setting. */
export interface ModelOverride extends Partial<VertexClaudeModel> {
	id: string;
	name: string;
	maxInputTokens: number;
	maxOutputTokens: number;
}

/**
 * Merge user overrides on top of the built-in catalog, matching by `id`.
 * Unknown ids are appended as new models.
 */
export function getEffectiveCatalog(overrides: ModelOverride[] = []): VertexClaudeModel[] {
	const byId = new Map<string, VertexClaudeModel>();
	for (const m of VERTEX_CLAUDE_MODELS) {
		byId.set(m.id, { ...m });
	}
	for (const o of overrides) {
		if (!o || typeof o.id !== 'string') {
			continue;
		}
		const existing = byId.get(o.id);
		byId.set(o.id, {
			family: 'claude',
			version: '',
			vision: true,
			toolCalling: true,
			...existing,
			...o
		} as VertexClaudeModel);
	}
	return [...byId.values()];
}

/** Convert a catalog entry into the VS Code `LanguageModelChatInformation` shape. */
export function toChatInformation(model: VertexClaudeModel): LanguageModelChatInformation {
	return {
		id: model.id,
		name: model.name,
		family: model.family,
		version: model.version,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		capabilities: {
			imageInput: model.vision,
			toolCalling: model.toolCalling
		}
	};
}
