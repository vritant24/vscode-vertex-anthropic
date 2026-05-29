import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
	saToken: 'sa-tok',
	expiryDate: 0,
	keyJson: JSON.stringify({ client_email: 'svc@example.iam.gserviceaccount.com', private_key: 'KEY' }),
	jwtCtorCalls: 0,
	getTokenCalls: 0
}));

vi.mock('node:child_process', () => ({
	// Default spawn simulates a missing gcloud binary (ENOENT).
	spawn: () => {
		const handlers: Record<string, (arg: any) => void> = {};
		const child: any = {
			stdout: { on: () => {} },
			stderr: { on: () => {} },
			on: (event: string, cb: (arg: any) => void) => {
				handlers[event] = cb;
				if (event === 'error') {
					queueMicrotask(() => {
						const err: NodeJS.ErrnoException = new Error('spawn gcloud ENOENT');
						err.code = 'ENOENT';
						cb(err);
					});
				}
			}
		};
		return child;
	}
}));

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(async () => state.keyJson)
}));

vi.mock('google-auth-library', () => ({
	JWT: class {
		credentials: { expiry_date?: number } = {};
		constructor() {
			state.jwtCtorCalls++;
		}
		async getAccessToken() {
			state.getTokenCalls++;
			this.credentials.expiry_date = state.expiryDate;
			return { token: state.saToken };
		}
	}
}));

import { AuthProvider, type AuthConfig } from '../auth';
import type { Log } from '../logger';

const noopLog: Log = {
	error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {}, child: () => noopLog
};

beforeEach(() => {
	state.jwtCtorCalls = 0;
	state.getTokenCalls = 0;
});

describe('AuthProvider (gcloud)', () => {
	it('caches the token and refreshes only after it nears expiry', async () => {
		let nowMs = 1_000_000;
		const tokens = ['tok-1', 'tok-2'];
		let i = 0;
		const runGcloud = vi.fn(async () => tokens[i++]);

		const cfg: AuthConfig = { authMode: 'gcloud' };
		const auth = new AuthProvider(() => cfg, noopLog, { runGcloud, now: () => nowMs });

		expect(await auth.getAccessToken()).toBe('tok-1');
		expect(await auth.getAccessToken()).toBe('tok-1');
		expect(runGcloud).toHaveBeenCalledTimes(1);

		// Advance past the cache window (55m - 5m skew = 50m).
		nowMs += 51 * 60 * 1000;
		expect(await auth.getAccessToken()).toBe('tok-2');
		expect(runGcloud).toHaveBeenCalledTimes(2);
	});

	it('clearCache forces a re-mint', async () => {
		const runGcloud = vi.fn(async () => 'fresh');
		const auth = new AuthProvider(() => ({ authMode: 'gcloud' }), noopLog, { runGcloud, now: () => 0 });

		await auth.getAccessToken();
		auth.clearCache();
		await auth.getAccessToken();
		expect(runGcloud).toHaveBeenCalledTimes(2);
	});

	it('throws an actionable error when gcloud is missing', async () => {
		const auth = new AuthProvider(() => ({ authMode: 'gcloud' }), noopLog);
		await expect(auth.getAccessToken()).rejects.toThrow(/gcloud CLI not found/);
	});
});

describe('AuthProvider (service-account)', () => {
	it('mints a token and caches it until near expiry', async () => {
		let nowMs = 0;
		state.expiryDate = 60 * 60 * 1000; // 1h from epoch
		const cfg: AuthConfig = { authMode: 'service-account', serviceAccountKeyPath: '/keys/sa.json' };
		const auth = new AuthProvider(() => cfg, noopLog, { now: () => nowMs });

		expect(await auth.getAccessToken()).toBe('sa-tok');
		expect(await auth.getAccessToken()).toBe('sa-tok');
		expect(state.getTokenCalls).toBe(1);

		// Past expiry - skew → refresh.
		nowMs = 60 * 60 * 1000;
		expect(await auth.getAccessToken()).toBe('sa-tok');
		expect(state.getTokenCalls).toBe(2);
	});

	it('errors when no key path is configured', async () => {
		const auth = new AuthProvider(() => ({ authMode: 'service-account' }), noopLog);
		await expect(auth.getAccessToken()).rejects.toThrow(/serviceAccountKeyPath/);
	});
});
