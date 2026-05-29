import { describe, it, expect, vi } from 'vitest';
import { LanguageModelTextPart, LanguageModelToolCallPart } from 'vscode';
import { streamToParts, type AnthropicEventStream } from '../stream';
import type { Log } from '../logger';

const noopLog: Log = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	trace: () => {},
	child: () => noopLog
};

function makeStream(events: any[], controller?: { abort: () => void }): AnthropicEventStream {
	return {
		controller,
		async *[Symbol.asyncIterator]() {
			for (const e of events) {
				yield e;
			}
		}
	};
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
	const out: any[] = [];
	for await (const part of gen) {
		out.push(part);
	}
	return out;
}

describe('streamToParts', () => {
	it('emits text and tool-call parts in order', async () => {
		const events = [
			{ type: 'message_start', message: { usage: { input_tokens: 3 } } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
			{ type: 'content_block_stop', index: 0 },
			{ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'foo' } },
			{ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
			{ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } },
			{ type: 'content_block_stop', index: 1 },
			{ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
			{ type: 'message_stop' }
		];

		const parts = await collect(
			streamToParts(makeStream(events), { isCancellationRequested: false } as any, noopLog)
		);

		expect(parts).toHaveLength(3);
		expect(parts[0]).toBeInstanceOf(LanguageModelTextPart);
		expect((parts[0] as LanguageModelTextPart).value).toBe('Hello');
		expect((parts[1] as LanguageModelTextPart).value).toBe(' world');
		expect(parts[2]).toBeInstanceOf(LanguageModelToolCallPart);
		const call = parts[2] as LanguageModelToolCallPart;
		expect(call.callId).toBe('t1');
		expect(call.name).toBe('foo');
		expect(call.input).toEqual({ a: 1 });
	});

	it('aborts the stream and stops iterating on cancellation', async () => {
		const abort = vi.fn();
		const events = [
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'should not surface' } }
		];

		const parts = await collect(
			streamToParts(makeStream(events, { abort }), { isCancellationRequested: true } as any, noopLog)
		);

		expect(parts).toHaveLength(0);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it('defaults malformed tool input to an empty object', async () => {
		const events = [
			{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't2', name: 'bar' } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'not json' } },
			{ type: 'content_block_stop', index: 0 },
			{ type: 'message_stop' }
		];

		const parts = await collect(
			streamToParts(makeStream(events), { isCancellationRequested: false } as any, noopLog)
		);

		expect(parts).toHaveLength(1);
		expect((parts[0] as LanguageModelToolCallPart).input).toEqual({});
	});
});
