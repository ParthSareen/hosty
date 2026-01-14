export type McpServerType = "node" | "python";

export interface McpServerInfo {
  type: McpServerType;
  path: string;
  entryPoint: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DeploymentResult {
  success: boolean;
  url?: string;
  projectName?: string;
  error?: string;
  mcpConfig?: McpClientConfig;
}

export interface McpClientConfig {
  name: string;
  transport: { type: "sse"; url: string };
  auth?: { type: "bearer"; token: string };
}

export interface DeployOptions {
  projectName?: string;
  team?: string;
  env?: Record<string, string>;
  production?: boolean;
  authToken?: string;
}

export interface DeployedServer {
  name: string;
  url: string;
  deployedAt: string;
  authToken?: string;
}
