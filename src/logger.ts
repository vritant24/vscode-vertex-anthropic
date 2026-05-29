export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_ORDER: Record<LogLevel, number> = {
	off: 0,
	error: 1,
	warn: 2,
	info: 3,
	debug: 4,
	trace: 5
};

/**
 * Minimal logging surface used across the extension. Kept free of any `vscode`
 * imports so modules like `auth.ts` remain unit-testable without the editor.
 */
export interface Log {
	error(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;
	child(scope: string): Log;
}

/** Sink that receives already-formatted lines. */
export interface LogSink {
	append(line: string): void;
}

function format(args: unknown[]): string {
	if (args.length === 0) {
		return '';
	}
	return ' ' + args
		.map((a) => (typeof a === 'string' ? a : safeStringify(a)))
		.join(' ');
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

class Logger implements Log {
	constructor(
		private readonly sink: LogSink,
		private readonly getLevel: () => LogLevel,
		private readonly scope?: string
	) {}

	private write(level: Exclude<LogLevel, 'off'>, message: string, args: unknown[]): void {
		if (LEVEL_ORDER[this.getLevel()] < LEVEL_ORDER[level]) {
			return;
		}
		const prefix = this.scope ? `[${this.scope}] ` : '';
		this.sink.append(`${prefix}${message}${format(args)}`);
	}

	error(message: string, ...args: unknown[]): void {
		this.write('error', message, args);
	}
	warn(message: string, ...args: unknown[]): void {
		this.write('warn', message, args);
	}
	info(message: string, ...args: unknown[]): void {
		this.write('info', message, args);
	}
	debug(message: string, ...args: unknown[]): void {
		this.write('debug', message, args);
	}
	trace(message: string, ...args: unknown[]): void {
		this.write('trace', message, args);
	}

	child(scope: string): Log {
		const childScope = this.scope ? `${this.scope}:${scope}` : scope;
		return new Logger(this.sink, this.getLevel, childScope);
	}
}

export function createLogger(sink: LogSink, getLevel: () => LogLevel): Log {
	return new Logger(sink, getLevel);
}
