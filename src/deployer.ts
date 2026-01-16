import { execa } from "execa";
import { writeFile, mkdir, access, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { McpServerInfo, DeploymentResult, DeployOptions, McpClientConfig } from "./types.js";
import { saveServer } from "./store.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function checkVercelCli(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execa("vercel", ["--version"]);
  } catch {
    return { ok: false, error: "Vercel CLI not found. Install: npm i -g vercel" };
  }

  try {
    await execa("vercel", ["whoami"], { timeout: 10000 });
    return { ok: true };
  } catch {
    return { ok: false, error: "Not logged in. Run: vercel login" };
  }
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

async function createNodeWrapper(
  info: McpServerInfo
): Promise<{ path: string; createdDir: boolean }> {
  const apiDir = join(info.path, "api");
  const createdDir = !(await exists(apiDir));
  await mkdir(apiDir, { recursive: true });

  const code = `
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

let server;
try {
  const mod = await import("../${info.entryPoint.replace(/\.ts$/, ".js")}");
  server = mod.server || (mod.createMcpServer && await mod.createMcpServer());
} catch (e) {
  console.error("Failed to load MCP server:", e);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.MCP_AUTH_TOKEN;
  if (token && req.headers.authorization !== \`Bearer \${token}\`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET" && !req.headers.accept?.includes("text/event-stream")) {
    return res.status(200).json({ status: "ok", mcp: true });
  }

  if (req.headers.accept?.includes("text/event-stream")) {
    if (!server) return res.status(500).json({ error: "Server not loaded" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const transport = new SSEServerTransport("/api/mcp", res);
    await server.connect(transport);
    return;
  }

  if (req.method === "POST") {
    return res.status(200).json({ received: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}
`.trim();

  const wrapperPath = join(apiDir, "mcp.js");
  await writeFile(wrapperPath, code);
  return { path: wrapperPath, createdDir };
}

async function createPythonWrapper(
  info: McpServerInfo
): Promise<{ path: string; createdDir: boolean }> {
  const apiDir = join(info.path, "api");
  const createdDir = !(await exists(apiDir));
  await mkdir(apiDir, { recursive: true });

  // Convert entry point to module path (e.g., src/server.py -> src.server)
  const modulePath = info.entryPoint.replace(/\.py$/, "").replace(/\//g, ".");

  const code = `
import os
import json
import asyncio
import importlib
from http.server import BaseHTTPRequestHandler

# Import the user's MCP server
try:
    mod = importlib.import_module("${modulePath}")
    server = getattr(mod, "server", None) or getattr(mod, "mcp_server", None)
    if hasattr(mod, "create_server"):
        server = mod.create_server()
except Exception as e:
    print(f"Failed to import MCP server: {e}")
    server = None

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if not self._check_auth():
            return

        accept = self.headers.get("Accept", "")
        if "text/event-stream" in accept:
            self._handle_sse()
        else:
            self._send_json(200, {"status": "ok", "mcp": True})

    def do_POST(self):
        if not self._check_auth():
            return
        self._send_json(200, {"received": True})

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _check_auth(self):
        token = os.environ.get("MCP_AUTH_TOKEN")
        if token:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {token}":
                self._send_json(401, {"error": "Unauthorized"})
                return False
        return True

    def _send_json(self, status, data):
        self.send_response(status)
        self._set_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _handle_sse(self):
        if not server:
            self._send_json(500, {"error": "Server not loaded"})
            return

        self.send_response(200)
        self._set_cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        # Note: Full SSE streaming requires async runtime support
        # This is a simplified handler - for production use mcp[cli] with fastmcp
        try:
            from mcp.server.sse import SseServerTransport
            transport = SseServerTransport("/api/mcp")
            asyncio.run(server.connect(transport))
        except Exception as e:
            self.wfile.write(f"data: {json.dumps({'error': str(e)})}\\n\\n".encode())
`.trim();

  const wrapperPath = join(apiDir, "mcp.py");
  await writeFile(wrapperPath, code);
  return { path: wrapperPath, createdDir };
}

async function createVercelConfig(
  info: McpServerInfo,
  token: string
): Promise<boolean> {
  const configPath = join(info.path, "vercel.json");
  if (await exists(configPath)) return false;

  const funcKey = info.type === "python" ? "api/mcp.py" : "api/mcp.js";
  const config: Record<string, unknown> = {
    version: 2,
    buildCommand: info.type === "node" ? "npm run build" : "",
    outputDirectory: "public",
    functions: { [funcKey]: { maxDuration: 60 } },
    env: { MCP_AUTH_TOKEN: token },
  };

  if (info.type === "python") {
    config.builds = [{ src: "api/mcp.py", use: "@vercel/python" }];
  }

  await writeFile(configPath, JSON.stringify(config, null, 2));
  return true;
}

export async function deploy(
  info: McpServerInfo,
  opts: DeployOptions = {}
): Promise<DeploymentResult> {
  const token = opts.authToken || generateToken();

  // Create appropriate wrapper
  const wrapper = info.type === "python"
    ? await createPythonWrapper(info)
    : await createNodeWrapper(info);

  const createdConfig = await createVercelConfig(info, token);

  // Create public folder for Vercel output
  const publicDir = join(info.path, "public");
  const createdPublic = !(await exists(publicDir));
  if (createdPublic) {
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, "index.html"), `<!DOCTYPE html><html><body>MCP Server: ${info.name}</body></html>`);
  }

  // Build TypeScript projects
  if (info.type === "node" && await exists(join(info.path, "tsconfig.json"))) {
    try {
      await execa("npm", ["run", "build"], { cwd: info.path, stdio: "pipe" });
    } catch {}
  }

  const args = ["deploy", "--yes"];
  if (opts.production) args.push("--prod");
  if (opts.team) args.push("--scope", opts.team);
  if (opts.projectName) args.push("--name", opts.projectName);
  args.push("--env", `MCP_AUTH_TOKEN=${token}`);

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push("--env", `${k}=${v}`);
    }
  }

  try {
    const result = await execa("vercel", args, { cwd: info.path, stdio: "pipe" });
    const deployUrl = result.stdout.trim().split("\n").pop() || "";

    if (!deployUrl.startsWith("http")) {
      return { success: false, error: `Unexpected output: ${result.stdout}` };
    }

    // Use production domain for --prod deployments
    const projectName = opts.projectName || info.name;
    const url = opts.production ? `https://${projectName}.vercel.app` : deployUrl;

    const mcpConfig: McpClientConfig = {
      name: info.name,
      transport: { type: "sse", url: `${url}/api/mcp` },
      auth: { type: "bearer", token },
    };

    await saveServer({
      name: info.name,
      url,
      deployedAt: new Date().toISOString(),
      authToken: token,
    });

    return { success: true, url, projectName, mcpConfig };
  } catch (e) {
    const err = e as Error & { stderr?: string };
    return { success: false, error: err.stderr || err.message };
  } finally {
    try {
      if (wrapper.createdDir) {
        await rm(dirname(wrapper.path), { recursive: true, force: true });
      } else {
        await rm(wrapper.path, { force: true });
      }
      if (createdConfig) {
        await rm(join(info.path, "vercel.json"), { force: true });
      }
      if (createdPublic) {
        await rm(publicDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
