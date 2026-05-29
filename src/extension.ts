import * as vscode from 'vscode';
import { AuthProvider, type AuthConfig } from './auth';
import { createLogger, type LogLevel } from './logger';
import { VertexAnthropicChatProvider } from './provider';

const VENDOR = 'vertex-anthropic';

export function activate(context: vscode.ExtensionContext): void {
	const channel = vscode.window.createOutputChannel('Anthropic on Vertex AI', { log: true });
	context.subscriptions.push(channel);

	const getLevel = (): LogLevel =>
		vscode.workspace.getConfiguration('vertexAnthropic').get<LogLevel>('logLevel') ?? 'info';
	const logger = createLogger({ append: (line) => channel.appendLine(line) }, getLevel);

	const getAuthConfig = (): AuthConfig => {
		const cfg = vscode.workspace.getConfiguration('vertexAnthropic');
		return {
			authMode: cfg.get<AuthConfig['authMode']>('authMode') ?? 'gcloud',
			serviceAccountKeyPath: cfg.get<string>('serviceAccountKeyPath') || undefined
		};
	};

	const auth = new AuthProvider(getAuthConfig, logger.child('auth'));
	const provider = new VertexAnthropicChatProvider(auth, logger.child('provider'));
	context.subscriptions.push(provider);
	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('vertexAnthropic.refreshModels', () => {
			logger.info('Refreshing models');
			provider.refresh();
		}),
		vscode.commands.registerCommand('vertexAnthropic.signOut', () => {
			auth.clearCache();
			vscode.window.showInformationMessage('Vertex Anthropic: cached token cleared.');
		})
	);

	// Re-evaluate models when relevant settings change.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration('vertexAnthropic.projectId') ||
				e.affectsConfiguration('vertexAnthropic.region') ||
				e.affectsConfiguration('vertexAnthropic.modelOverrides')
			) {
				provider.refresh();
			}
		})
	);

	logger.info('Anthropic on Vertex AI activated');
}

export function deactivate(): void {}
