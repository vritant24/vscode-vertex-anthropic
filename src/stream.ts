import { LanguageModelTextPart, LanguageModelToolCallPart, type CancellationToken, type LanguageModelResponsePart } from 'vscode';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import type { Log } from './logger';

/** The subset of the Anthropic SDK stream that we rely on. */
export interface AnthropicEventStream extends AsyncIterable<RawMessageStreamEvent> {
	controller?: { abort(): void };
}

interface PendingToolCall {
	id: string;
	name: string;
	jsonInput: string;
}

/**
 * Consume the Anthropic streaming events and yield VS Code response parts.
 * Honors cancellation by aborting the underlying stream.
 */
export async function* streamToParts(
	stream: AnthropicEventStream,
	token: CancellationToken,
	log: Log
): AsyncGenerator<LanguageModelResponsePart> {
	const pending = new Map<number, PendingToolCall>();

	for await (const event of stream) {
		if (token.isCancellationRequested) {
			log.debug('Cancellation requested — aborting stream');
			stream.controller?.abort();
			return;
		}

		switch (event.type) {
			case 'message_start':
				log.trace('message_start', event.message?.usage);
				break;

			case 'content_block_start':
				if (event.content_block?.type === 'tool_use') {
					pending.set(event.index, {
						id: event.content_block.id,
						name: event.content_block.name,
						jsonInput: ''
					});
				}
				break;

			case 'content_block_delta': {
				const delta = event.delta;
				if (delta.type === 'text_delta') {
					yield new LanguageModelTextPart(delta.text);
				} else if (delta.type === 'input_json_delta') {
					const tc = pending.get(event.index);
					if (tc) {
						tc.jsonInput += delta.partial_json;
					}
				} else if (delta.type === 'thinking_delta') {
					// The stable vscode.lm response API has no thinking part; skip.
					log.trace('thinking_delta (not surfaced)');
				}
				break;
			}

			case 'content_block_stop': {
				const tc = pending.get(event.index);
				if (tc) {
					pending.delete(event.index);
					yield new LanguageModelToolCallPart(tc.id, tc.name, parseToolInput(tc.jsonInput, log));
				}
				break;
			}

			case 'message_delta':
				log.trace('message_delta', { stop_reason: event.delta?.stop_reason, usage: event.usage });
				break;

			case 'message_stop':
				log.trace('message_stop');
				return;
		}
	}
}

function parseToolInput(json: string, log: Log): object {
	const text = json.trim() || '{}';
	try {
		return JSON.parse(text);
	} catch {
		log.warn(`Failed to parse tool input JSON, defaulting to {}: ${text}`);
		return {};
	}
}
