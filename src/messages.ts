import {
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
	type LanguageModelChatRequestMessage,
	type LanguageModelChatTool,
	LanguageModelChatToolMode
} from 'vscode';
import type {
	ContentBlockParam,
	ImageBlockParam,
	MessageParam,
	TextBlockParam,
	Tool,
	ToolChoice,
	ToolResultBlockParam
} from '@anthropic-ai/sdk/resources/messages';

export interface ConvertedMessages {
	system: TextBlockParam[];
	messages: MessageParam[];
}

type Role = 'user' | 'assistant';

function isImageMime(mime: string): boolean {
	return mime.startsWith('image/');
}

function toBase64(data: Uint8Array): string {
	return Buffer.from(data).toString('base64');
}

type Base64MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function imageBlock(part: LanguageModelDataPart): ImageBlockParam {
	return {
		type: 'image',
		source: {
			type: 'base64',
			media_type: part.mimeType as Base64MediaType,
			data: toBase64(part.data)
		}
	};
}

/** Map the nested content parts of a tool result. */
function toToolResultContent(
	content: ReadonlyArray<unknown>
): Array<TextBlockParam | ImageBlockParam> {
	const out: Array<TextBlockParam | ImageBlockParam> = [];
	for (const part of content) {
		if (part instanceof LanguageModelTextPart) {
			if (part.value) {
				out.push({ type: 'text', text: part.value });
			}
		} else if (part instanceof LanguageModelDataPart && isImageMime(part.mimeType)) {
			out.push(imageBlock(part));
		} else if (typeof part === 'string') {
			if (part) {
				out.push({ type: 'text', text: part });
			}
		} else {
			out.push({ type: 'text', text: safeStringify(part) });
		}
	}
	if (out.length === 0) {
		out.push({ type: 'text', text: '' });
	}
	return out;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function classifyRole(role: unknown): Role | 'system' {
	if (role === LanguageModelChatMessageRole.Assistant) {
		return 'assistant';
	}
	// The provider role enum only exposes User/Assistant, but a System sentinel
	// (value 0) may be present in some hosts/tests — treat it as system.
	if (role === (LanguageModelChatMessageRole as Record<string, unknown>).System) {
		return 'system';
	}
	return 'user';
}

/**
 * Convert VS Code chat request messages into the Anthropic Messages API shape,
 * splitting out system text and merging consecutive same-role messages.
 */
export function convertMessages(
	messages: readonly LanguageModelChatRequestMessage[]
): ConvertedMessages {
	const system: TextBlockParam[] = [];
	const built: Array<{ role: Role; content: ContentBlockParam[] }> = [];

	for (const msg of messages) {
		const role = classifyRole(msg.role);
		if (role === 'system') {
			for (const part of msg.content) {
				if (part instanceof LanguageModelTextPart && part.value) {
					system.push({ type: 'text', text: part.value });
				}
			}
			continue;
		}

		const content: ContentBlockParam[] = [];
		for (const part of msg.content) {
			if (part instanceof LanguageModelTextPart) {
				if (part.value) {
					content.push({ type: 'text', text: part.value });
				}
			} else if (part instanceof LanguageModelToolCallPart) {
				content.push({
					type: 'tool_use',
					id: part.callId,
					name: part.name,
					input: part.input
				});
			} else if (part instanceof LanguageModelToolResultPart) {
				const block: ToolResultBlockParam = {
					type: 'tool_result',
					tool_use_id: part.callId,
					content: toToolResultContent(part.content)
				};
				content.push(block);
			} else if (part instanceof LanguageModelDataPart && isImageMime(part.mimeType)) {
				content.push(imageBlock(part));
			}
		}

		if (content.length === 0) {
			continue;
		}
		built.push({ role, content });
	}

	// Merge consecutive messages sharing a role (Anthropic API requirement).
	const merged: MessageParam[] = [];
	for (const m of built) {
		const last = merged[merged.length - 1];
		if (last && last.role === m.role) {
			(last.content as ContentBlockParam[]).push(...m.content);
		} else {
			merged.push({ role: m.role, content: m.content });
		}
	}

	// Anthropic requires the conversation to end with a user turn.
	const last = merged[merged.length - 1];
	if (!last || last.role !== 'user') {
		merged.push({ role: 'user', content: [{ type: 'text', text: 'Please continue.' }] });
	}

	return { system, messages: merged };
}

/** Convert VS Code tools into Anthropic tool definitions. */
export function convertTools(tools?: readonly LanguageModelChatTool[]): Tool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	return tools.map((t) => ({
		name: t.name,
		description: t.description ?? '',
		input_schema: (t.inputSchema as Tool['input_schema']) ?? { type: 'object', properties: {} }
	}));
}

/** Convert VS Code tool mode into an Anthropic `tool_choice`. */
export function convertToolMode(
	mode: LanguageModelChatToolMode | undefined,
	hasTools: boolean
): ToolChoice | undefined {
	if (!hasTools) {
		return undefined;
	}
	return mode === LanguageModelChatToolMode.Required
		? { type: 'any' }
		: { type: 'auto' };
}
