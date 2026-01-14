/**
 * Detect and validate MCP server projects
 */

import { readFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import type { McpServerInfo, McpServerType } from "./types.js";

const NODE_MCP_PACKAGES = [
  "@modelcontextprotocol/sdk",
  "mcp",
  "@anthropic-ai/sdk", // Some use this directly
];

const PYTHON_MCP_PACKAGES = ["mcp", "modelcontextprotocol"];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectNodeProject(
  projectPath: string
): Promise<McpServerInfo | null> {
  const packageJsonPath = join(projectPath, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const hasMcpDep = NODE_MCP_PACKAGES.some((dep) => dep in allDeps);

    if (!hasMcpDep) {
      return null;
    }

    // Find entry point
    const possibleEntries = [
      pkg.main,
      "src/index.ts",
      "src/index.js",
      "index.ts",
      "index.js",
      "src/server.ts",
      "server.ts",
    ].filter(Boolean);

    let entryPoint = "";
    for (const entry of possibleEntries) {
      if (await fileExists(join(projectPath, entry))) {
        entryPoint = entry;
        break;
      }
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!entryPoint) {
      errors.push("Could not find entry point (index.ts, server.ts, etc.)");
    }

    // Check for Vercel compatibility
    const vercelJsonPath = join(projectPath, "vercel.json");
    if (!(await fileExists(vercelJsonPath))) {
      warnings.push("No vercel.json found - will use defaults");
    }

    return {
      type: "node",
      path: projectPath,
      entryPoint,
      name: pkg.name || basename(projectPath),
      transport: "http", // Default for Vercel deployment
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  } catch {
    return null;
  }
}

async function detectPythonProject(
  projectPath: string
): Promise<McpServerInfo | null> {
  // Check for pyproject.toml or requirements.txt
  const pyprojectPath = join(projectPath, "pyproject.toml");
  const requirementsPath = join(projectPath, "requirements.txt");

  const hasPyproject = await fileExists(pyprojectPath);
  const hasRequirements = await fileExists(requirementsPath);

  if (!hasPyproject && !hasRequirements) {
    return null;
  }

  let hasMcpDep = false;
  let name = basename(projectPath);

  // Check pyproject.toml
  if (hasPyproject) {
    try {
      const content = await readFile(pyprojectPath, "utf-8");
      hasMcpDep = PYTHON_MCP_PACKAGES.some((pkg) => content.includes(pkg));

      // Extract name from pyproject.toml (basic parsing)
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch) {
        name = nameMatch[1];
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check requirements.txt
  if (!hasMcpDep && hasRequirements) {
    try {
      const content = await readFile(requirementsPath, "utf-8");
      hasMcpDep = PYTHON_MCP_PACKAGES.some((pkg) => content.includes(pkg));
    } catch {
      // Ignore
    }
  }

  if (!hasMcpDep) {
    return null;
  }

  // Find entry point
  const possibleEntries = [
    "server.py",
    "main.py",
    "app.py",
    "src/server.py",
    "src/main.py",
    "__main__.py",
  ];

  let entryPoint = "";
  for (const entry of possibleEntries) {
    if (await fileExists(join(projectPath, entry))) {
      entryPoint = entry;
      break;
    }
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!entryPoint) {
    errors.push("Could not find entry point (server.py, main.py, etc.)");
  }

  return {
    type: "python",
    path: projectPath,
    entryPoint,
    name,
    transport: "http",
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect MCP server in a directory
 */
export async function detect(projectPath: string): Promise<McpServerInfo> {
  // Try Node first, then Python
  const nodeInfo = await detectNodeProject(projectPath);
  if (nodeInfo) {
    return nodeInfo;
  }

  const pythonInfo = await detectPythonProject(projectPath);
  if (pythonInfo) {
    return pythonInfo;
  }

  // Not an MCP project
  return {
    type: "node",
    path: projectPath,
    entryPoint: "",
    name: basename(projectPath),
    transport: "stdio",
    isValid: false,
    errors: [
      "Not an MCP server project. Expected package.json with @modelcontextprotocol/sdk or pyproject.toml with mcp dependency.",
    ],
    warnings: [],
  };
}

/**
 * Pretty print detection results
 */
export function formatDetectionResult(info: McpServerInfo): string {
  const lines: string[] = [];

  if (info.isValid) {
    lines.push(`Detected ${info.type} MCP server: ${info.name}`);
    lines.push(`  Entry: ${info.entryPoint}`);
  } else {
    lines.push(`Not a valid MCP server project`);
    for (const err of info.errors) {
      lines.push(`  - ${err}`);
    }
  }

  for (const warn of info.warnings) {
    lines.push(`  Warning: ${warn}`);
  }

  return lines.join("\n");
}
