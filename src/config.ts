import type { McpClientConfig } from "./types.js";

export function generateClaudeDesktopConfig(config: McpClientConfig): string {
  const serverConfig: Record<string, unknown> = {
    transport: config.transport,
  };

  if (config.auth) {
    serverConfig.headers = {
      Authorization: `Bearer ${config.auth.token}`,
    };
  }

  return JSON.stringify({ mcpServers: { [config.name]: serverConfig } }, null, 2);
}
