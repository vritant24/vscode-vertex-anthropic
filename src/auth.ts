import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import type { Log } from './logger';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
/** Refresh this many ms before the token actually expires. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** Fallback lifetime when an exact expiry is unknown (gcloud tokens last ~60m). */
const DEFAULT_TTL_MS = 55 * 60 * 1000;

export type AuthMode = 'gcloud' | 'service-account';

export interface AuthConfig {
	authMode: AuthMode;
	serviceAccountKeyPath?: string;
}

interface CachedToken {
	token: string;
	/** Epoch ms after which the token must be refreshed (skew already applied). */
	refreshAt: number;
}

/** Allow tests to stub the gcloud invocation. */
export type GcloudRunner = () => Promise<string>;

export interface AuthProviderDeps {
	runGcloud?: GcloudRunner;
	now?: () => number;
}

/**
 * Mints and caches GCP IAM Bearer tokens for Vertex AI. Tokens are kept in
 * memory only — never written to secret storage or disk.
 */
export class AuthProvider {
	private cache: CachedToken | undefined;
	private inflight: Promise<string> | undefined;
	private readonly runGcloud: GcloudRunner;
	private readonly now: () => number;

	constructor(
		private readonly getConfig: () => AuthConfig,
		private readonly log: Log,
		deps: AuthProviderDeps = {}
	) {
		this.runGcloud = deps.runGcloud ?? defaultRunGcloud;
		this.now = deps.now ?? (() => Date.now());
	}

	async getAccessToken(): Promise<string> {
		const cached = this.cache;
		if (cached && this.now() < cached.refreshAt) {
			this.log.trace('Using cached access token');
			return cached.token;
		}
		if (this.inflight) {
			return this.inflight;
		}
		this.inflight = this.refresh().finally(() => {
			this.inflight = undefined;
		});
		return this.inflight;
	}

	clearCache(): void {
		this.cache = undefined;
		this.log.info('Cleared cached access token');
	}

	private async refresh(): Promise<string> {
		const { authMode } = this.getConfig();
		this.log.debug(`Minting access token via "${authMode}"`);
		const minted = authMode === 'service-account'
			? await this.mintFromServiceAccount()
			: await this.mintFromGcloud();
		this.cache = minted;
		return minted.token;
	}

	private async mintFromGcloud(): Promise<CachedToken> {
		const token = (await this.runGcloud()).trim();
		if (!token) {
			throw new Error('`gcloud auth print-access-token` returned an empty token. Run `gcloud auth application-default login`.');
		}
		return { token, refreshAt: this.now() + DEFAULT_TTL_MS - REFRESH_SKEW_MS };
	}

	private async mintFromServiceAccount(): Promise<CachedToken> {
		const { serviceAccountKeyPath } = this.getConfig();
		if (!serviceAccountKeyPath) {
			throw new Error('Auth mode is "service-account" but no `vertexAnthropic.serviceAccountKeyPath` is set.');
		}
		let key: { client_email?: string; private_key?: string };
		try {
			key = JSON.parse(await readFile(serviceAccountKeyPath, 'utf8'));
		} catch (err) {
			throw new Error(`Failed to read service-account key at "${serviceAccountKeyPath}": ${errorMessage(err)}`);
		}
		if (!key.client_email || !key.private_key) {
			throw new Error(`Service-account key at "${serviceAccountKeyPath}" is missing client_email/private_key.`);
		}
		const client = new JWT({
			email: key.client_email,
			key: key.private_key,
			scopes: [CLOUD_PLATFORM_SCOPE]
		});
		const { token } = await client.getAccessToken();
		if (!token) {
			throw new Error('Service-account authentication returned an empty token.');
		}
		const expiryDate = client.credentials?.expiry_date;
		const refreshAt = typeof expiryDate === 'number'
			? expiryDate - REFRESH_SKEW_MS
			: this.now() + DEFAULT_TTL_MS - REFRESH_SKEW_MS;
		return { token, refreshAt };
	}
}

function defaultRunGcloud(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let child;
		try {
			child = spawn('gcloud', ['auth', 'print-access-token', '--quiet']);
		} catch {
			reject(gcloudMissingError());
			return;
		}
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (d) => { stdout += d.toString(); });
		child.stderr?.on('data', (d) => { stderr += d.toString(); });
		child.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				reject(gcloudMissingError());
			} else {
				reject(err);
			}
		});
		child.on('close', (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(`gcloud exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
			}
		});
	});
}

function gcloudMissingError(): Error {
	return new Error('gcloud CLI not found. Install Google Cloud SDK and run `gcloud auth application-default login`.');
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
