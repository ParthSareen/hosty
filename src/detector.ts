import { readFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import type { McpServerInfo } from "./types.js";

const NODE_MCP_PACKAGES = ["@modelcontextprotocol/sdk", "mcp"];
const PYTHON_MCP_PACKAGES = ["mcp", "modelcontextprotocol"];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectNode(dir: string): Promise<McpServerInfo | null> {
  const pkgPath = join(dir, "package.json");
  if (!(await exists(pkgPath))) return null;

  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasMcp = NODE_MCP_PACKAGES.some((d) => d in deps);
    if (!hasMcp) return null;

    const entries = [
      pkg.main,
      "src/index.ts",
      "src/index.js",
      "index.ts",
      "index.js",
      "src/server.ts",
      "server.ts",
    ].filter(Boolean);

    let entry = "";
    for (const e of entries) {
      if (await exists(join(dir, e))) {
        entry = e;
        break;
      }
    }

    const errors: string[] = [];
    if (!entry) errors.push("No entry point found (index.ts, server.ts, etc.)");

    return {
      type: "node",
      path: dir,
      entryPoint: entry,
      name: pkg.name || basename(dir),
      transport: "http",
      isValid: errors.length === 0,
      errors,
      warnings: [],
    };
  } catch {
    return null;
  }
}

async function detectPython(dir: string): Promise<McpServerInfo | null> {
  const pyproject = join(dir, "pyproject.toml");
  const requirements = join(dir, "requirements.txt");

  const hasPyproject = await exists(pyproject);
  const hasRequirements = await exists(requirements);
  if (!hasPyproject && !hasRequirements) return null;

  let hasMcp = false;
  let name = basename(dir);

  if (hasPyproject) {
    try {
      const content = await readFile(pyproject, "utf-8");
      hasMcp = PYTHON_MCP_PACKAGES.some((p) => content.includes(p));
      const m = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (m) name = m[1];
    } catch {}
  }

  if (!hasMcp && hasRequirements) {
    try {
      const content = await readFile(requirements, "utf-8");
      hasMcp = PYTHON_MCP_PACKAGES.some((p) => content.includes(p));
    } catch {}
  }

  if (!hasMcp) return null;

  const entries = ["server.py", "main.py", "app.py", "src/server.py", "src/main.py"];
  let entry = "";
  for (const e of entries) {
    if (await exists(join(dir, e))) {
      entry = e;
      break;
    }
  }

  const errors: string[] = [];
  if (!entry) errors.push("No entry point found (server.py, main.py, etc.)");

  return {
    type: "python",
    path: dir,
    entryPoint: entry,
    name,
    transport: "http",
    isValid: errors.length === 0,
    errors,
    warnings: [],
  };
}

export async function detect(dir: string): Promise<McpServerInfo> {
  const node = await detectNode(dir);
  if (node) return node;

  const python = await detectPython(dir);
  if (python) return python;

  return {
    type: "node",
    path: dir,
    entryPoint: "",
    name: basename(dir),
    transport: "stdio",
    isValid: false,
    errors: ["Not an MCP project. Need package.json with @modelcontextprotocol/sdk or pyproject.toml with mcp."],
    warnings: [],
  };
}
