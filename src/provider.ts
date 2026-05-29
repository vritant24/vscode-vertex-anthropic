import * as vscode from 'vscode';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { AuthProvider } from './auth';
import type { Log } from './logger';
import { getEffectiveCatalog, toChatInformation, type ModelOverride } from './models';
import { convertMessages, convertTools, convertToolMode } from './messages';
import { streamToParts, type AnthropicEventStream } from './stream';

interface VertexConfig {
	projectId: string;
	region: string;
	modelOverrides: ModelOverride[];
}

function readVertexConfig(): VertexConfig {
	const cfg = vscode.workspace.getConfiguration('vertexAnthropic');
	return {
		projectId: (cfg.get<string>('projectId') ?? '').trim(),
		region: cfg.get<string>('region') ?? 'global',
		modelOverrides: cfg.get<ModelOverride[]>('modelOverrides') ?? []
	};
}

export class VertexAnthropicChatProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	constructor(
		private readonly auth: AuthProvider,
		private readonly log: Log
	) {}

	/** Notify VS Code that the available model set may have changed. */
	refresh(): void {
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		const cfg = readVertexConfig();
		if (!cfg.projectId) {
			this.log.info('No projectId configured — reporting zero models.');
			return [];
		}
		return getEffectiveCatalog(cfg.modelOverrides).map(toChatInformation);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const cfg = readVertexConfig();
		if (!cfg.projectId) {
			throw new Error('No GCP Project ID configured. Set `vertexAnthropic.projectId` in Settings.');
		}

		const accessToken = await this.auth.getAccessToken();
		const client = new AnthropicVertex({
			projectId: cfg.projectId,
			region: cfg.region,
			accessToken
		});

		const { system, messages: amsg } = convertMessages(messages);
		const tools = convertTools(options.tools);
		const toolChoice = convertToolMode(options.toolMode, !!tools);

		this.log.debug(`Requesting model=${model.id} region=${cfg.region} tools=${tools?.length ?? 0}`);

		let stream: AnthropicEventStream;
		try {
			stream = (await client.messages.create({
				model: model.id,
				max_tokens: model.maxOutputTokens,
				system: system.length > 0 ? system : undefined,
				messages: amsg,
				tools,
				tool_choice: toolChoice,
				stream: true
			})) as unknown as AnthropicEventStream;
		} catch (err) {
			throw this.wrapError(err, cfg);
		}

		try {
			for await (const part of streamToParts(stream, token, this.log)) {
				progress.report(part);
			}
		} catch (err) {
			if (token.isCancellationRequested) {
				this.log.debug('Stream ended due to cancellation.');
				return;
			}
			throw this.wrapError(err, cfg);
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		const s = typeof text === 'string' ? text : JSON.stringify(text);
		// Approximate: Vertex does not expose a free local tokenizer.
		return Math.ceil(s.length / 4);
	}

	private wrapError(err: unknown, cfg: VertexConfig): Error {
		const message = err instanceof Error ? err.message : String(err);
		this.log.error(`Vertex request failed: ${message}`);
		if (/not found|404|permission|403|PERMISSION_DENIED/i.test(message)) {
			return new Error(
				`Vertex AI request failed for project "${cfg.projectId}" (region "${cfg.region}"). ` +
				`Verify the project ID, that the Vertex AI API is enabled, the Claude model is enabled in Model Garden, ` +
				`and that your account has the "Vertex AI User" role. Original error: ${message}`
			);
		}
		return err instanceof Error ? err : new Error(message);
	}
}
