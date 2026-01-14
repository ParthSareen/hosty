/**
 * Generate MCP client configuration snippets
 */

import type { McpClientConfig, DeploymentResult } from "./types.js";

/**
 * Generate Claude Desktop config snippet
 */
export function generateClaudeDesktopConfig(config: McpClientConfig): string {
  const serverConfig: Record<string, unknown> = {
    transport: config.transport,
  };

  if (config.auth) {
    serverConfig.headers = {
      Authorization: `Bearer ${config.auth.token}`,
    };
  }

  const fullConfig = {
    mcpServers: {
      [config.name]: serverConfig,
    },
  };

  return JSON.stringify(fullConfig, null, 2);
}

/**
 * Generate generic MCP client config
 */
export function generateGenericConfig(config: McpClientConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Format config output for CLI display
 */
export function formatConfigOutput(result: DeploymentResult): string {
  if (!result.success || !result.mcpConfig) {
    return "";
  }

  const config = result.mcpConfig;
  const lines: string[] = [];

  lines.push("Add to your Claude Desktop config (~/.claude/claude_desktop_config.json):");
  lines.push("");
  lines.push(generateClaudeDesktopConfig(config));
  lines.push("");
  lines.push("Or use the URL directly:");
  lines.push(`  ${config.transport.url}`);

  if (config.auth) {
    lines.push("");
    lines.push("With header:");
    lines.push(`  Authorization: Bearer ${config.auth.token}`);
  }

  return lines.join("\n");
}

/**
 * Generate a curl command to test the endpoint
 */
export function generateTestCommand(config: McpClientConfig): string {
  const headers = config.auth
    ? `-H "Authorization: Bearer ${config.auth.token}"`
    : "";

  return `curl ${headers} "${config.transport.url}"`.trim();
}
