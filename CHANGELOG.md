# Changelog

All notable changes to the "Anthropic on Vertex AI" extension are documented in this file.

## [0.1.0] - 2026-05-29

### Added
- Initial release.
- Language Model Chat Provider for Anthropic Claude models on Google Vertex AI (vendor `vertex-anthropic`).
- Streaming chat responses, tool calling, vision, and thinking support.
- Authentication via `gcloud` Application Default Credentials or a service-account JSON key.
- Static model catalog with user overrides via `vertexAnthropic.modelOverrides`.
- Commands: `Vertex Anthropic: Refresh Models` and `Vertex Anthropic: Clear Cached Token`.
