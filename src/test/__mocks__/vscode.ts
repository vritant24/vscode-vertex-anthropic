// Minimal hand-written mock of the `vscode` module for unit tests.
// Only the symbols used by messages.ts / stream.ts are implemented.

export enum LanguageModelChatMessageRole {
	System = 0,
	User = 1,
	Assistant = 2
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2
}

export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: object
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: Array<unknown>
	) {}
}

export class LanguageModelPromptTsxPart {
	constructor(public value: unknown) {}
}

export class LanguageModelDataPart {
	constructor(
		public data: Uint8Array,
		public mimeType: string
	) {}

	static image(data: Uint8Array, mime: string): LanguageModelDataPart {
		return new LanguageModelDataPart(data, mime);
	}

	static text(value: string, mime = 'text/plain'): LanguageModelDataPart {
		return new LanguageModelDataPart(new TextEncoder().encode(value), mime);
	}

	static json(value: unknown, mime = 'application/json'): LanguageModelDataPart {
		return new LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(value)), mime);
	}
}

export class CancellationTokenSource {
	private _cancelled = false;
	token = {
		get isCancellationRequested() {
			return false;
		},
		onCancellationRequested: () => ({ dispose() {} })
	};
	cancel() {
		this._cancelled = true;
	}
	dispose() {}
}

export type CancellationToken = { isCancellationRequested: boolean };
export type LanguageModelResponsePart =
	| LanguageModelTextPart
	| LanguageModelToolCallPart
	| LanguageModelToolResultPart
	| LanguageModelDataPart;
