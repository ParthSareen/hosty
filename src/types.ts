/**
 * Core types for hosty
 */

export type McpServerType = "node" | "python";

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerInfo {
  /** Detected server type */
  type: McpServerType;

  /** Path to the MCP server project */
  path: string;

  /** Entry point file (e.g., index.ts, server.py) */
  entryPoint: string;

  /** Name from package.json or pyproject.toml */
  name: string;

  /** Detected transport type */
  transport: McpTransport;

  /** Whether the project is valid for deployment */
  isValid: boolean;

  /** Validation errors if any */
  errors: string[];

  /** Validation warnings */
  warnings: string[];
}

export interface DeploymentResult {
  /** Whether deployment was successful */
  success: boolean;

  /** Deployed URL */
  url?: string;

  /** Project name on Vercel */
  projectName?: string;

  /** Error message if failed */
  error?: string;

  /** MCP configuration for clients */
  mcpConfig?: McpClientConfig;
}

export interface McpClientConfig {
  /** Server name for config */
  name: string;

  /** Transport configuration */
  transport: {
    type: "sse";
    url: string;
  };

  /** Optional authentication */
  auth?: {
    type: "bearer";
    token: string;
  };
}

export interface DeployOptions {
  /** Vercel project name (auto-generated if not provided) */
  projectName?: string;

  /** Vercel team/org scope */
  team?: string;

  /** Environment variables to set */
  env?: Record<string, string>;

  /** Whether to create production deployment */
  production?: boolean;

  /** Bearer token for auth (auto-generated if not provided) */
  authToken?: string;
}

export interface HostyConfig {
  /** Vercel access token */
  vercelToken?: string;

  /** Default team/org */
  defaultTeam?: string;

  /** Deployed servers registry */
  servers?: Record<string, DeployedServer>;
}

export interface DeployedServer {
  /** Server name */
  name: string;

  /** Deployed URL */
  url: string;

  /** When it was deployed */
  deployedAt: string;

  /** Vercel project ID */
  projectId?: string;

  /** Auth token if set */
  authToken?: string;
}
