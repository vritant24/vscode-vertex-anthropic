import { describe, it, expect } from 'vitest';
import {
	LanguageModelChatMessageRole as Role,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
	LanguageModelChatToolMode
} from 'vscode';
import { convertMessages, convertTools, convertToolMode } from '../messages';

// The stable provider role enum only exposes User/Assistant; a System sentinel
// (value 0) is recognised by the converter, so reference it numerically here.
const SYSTEM = 0 as unknown as Role;

function msg(role: number, content: unknown[]) {
	return { role, content, name: undefined } as any;
}

describe('convertMessages', () => {
	it('splits system text and preserves user/assistant order', () => {
		const { system, messages } = convertMessages([
			msg(SYSTEM, [new LanguageModelTextPart('be nice')]),
			msg(Role.User, [new LanguageModelTextPart('hi')]),
			msg(Role.Assistant, [new LanguageModelTextPart('hello')]),
			msg(Role.User, [new LanguageModelTextPart('again')])
		]);

		expect(system).toEqual([{ type: 'text', text: 'be nice' }]);
		expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
		expect(messages[0].content).toEqual([{ type: 'text', text: 'hi' }]);
	});

	it('round-trips tool calls and tool results', () => {
		const { messages } = convertMessages([
			msg(Role.User, [new LanguageModelTextPart('search please')]),
			msg(Role.Assistant, [new LanguageModelToolCallPart('call-1', 'search', { q: 'cats' })]),
			msg(Role.User, [new LanguageModelToolResultPart('call-1', [new LanguageModelTextPart('found')])])
		]);

		const assistant = messages.find((m) => m.role === 'assistant')!;
		expect(assistant.content).toEqual([
			{ type: 'tool_use', id: 'call-1', name: 'search', input: { q: 'cats' } }
		]);

		const last = messages[messages.length - 1];
		expect(last.role).toBe('user');
		expect(last.content).toEqual([
			{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'found' }] }
		]);
	});

	it('merges consecutive same-role messages', () => {
		const { messages } = convertMessages([
			msg(Role.User, [new LanguageModelTextPart('a')]),
			msg(Role.User, [new LanguageModelTextPart('b')])
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0].content).toEqual([
			{ type: 'text', text: 'a' },
			{ type: 'text', text: 'b' }
		]);
	});

	it('appends a synthetic user turn when the last message is from the assistant', () => {
		const { messages } = convertMessages([
			msg(Role.User, [new LanguageModelTextPart('hi')]),
			msg(Role.Assistant, [new LanguageModelTextPart('bye')])
		]);

		expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
		expect(messages[messages.length - 1].content).toEqual([
			{ type: 'text', text: 'Please continue.' }
		]);
	});

	it('drops empty text parts', () => {
		const { messages } = convertMessages([
			msg(Role.User, [new LanguageModelTextPart(''), new LanguageModelTextPart('keep')])
		]);

		expect(messages[0].content).toEqual([{ type: 'text', text: 'keep' }]);
	});

	it('encodes image data parts as base64 image blocks', () => {
		const data = new Uint8Array([1, 2, 3, 4]);
		const { messages } = convertMessages([
			msg(Role.User, [LanguageModelDataPart.image(data, 'image/png')])
		]);

		expect(messages[0].content).toEqual([
			{
				type: 'image',
				source: {
					type: 'base64',
					media_type: 'image/png',
					data: Buffer.from(data).toString('base64')
				}
			}
		]);
	});
});

describe('convertTools / convertToolMode', () => {
	it('maps tools and defaults the input schema', () => {
		const tools = convertTools([
			{ name: 'a', description: 'desc', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
			{ name: 'b', description: '' }
		] as any);

		expect(tools).toEqual([
			{ name: 'a', description: 'desc', input_schema: { type: 'object', properties: { x: { type: 'string' } } } },
			{ name: 'b', description: '', input_schema: { type: 'object', properties: {} } }
		]);
	});

	it('returns undefined tool_choice when there are no tools', () => {
		expect(convertTools([])).toBeUndefined();
		expect(convertToolMode(LanguageModelChatToolMode.Auto, false)).toBeUndefined();
	});

	it('maps tool mode to anthropic tool_choice', () => {
		expect(convertToolMode(LanguageModelChatToolMode.Auto, true)).toEqual({ type: 'auto' });
		expect(convertToolMode(LanguageModelChatToolMode.Required, true)).toEqual({ type: 'any' });
	});
});
