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
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

let server;
let transport;

try {
  const mod = await import("../${info.entryPoint.replace(/\.ts$/, ".js")}");
  server = mod.server || (mod.createMcpServer && await mod.createMcpServer());

  // Create stateless transport for serverless
  transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
} catch (e) {
  console.error("Failed to load MCP server:", e);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.MCP_AUTH_TOKEN;
  if (token && req.headers.authorization !== \`Bearer \${token}\`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!server || !transport) {
    return res.status(500).json({ error: "Server not initialized" });
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
}
`.trim();

  const wrapperPath = join(apiDir, "mcp.js");
  await writeFile(wrapperPath, code);

  // Create separate OAuth metadata endpoint
  const oauthCode = `
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = \`\${proto}://\${host}\`;
  res.status(200).json({
    issuer: baseUrl,
    authorization_endpoint: \`\${baseUrl}/oauth/authorize\`,
    token_endpoint: \`\${baseUrl}/oauth/token\`,
    registration_endpoint: \`\${baseUrl}/oauth/register\`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"]
  });
}
`.trim();
  await writeFile(join(apiDir, "oauth-metadata.js"), oauthCode);

  // Create OAuth registration endpoint for dynamic client registration
  const registerCode = `
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Generate a client_id for the registering client
  const clientId = "mcp-client-" + Math.random().toString(36).substring(2, 15);

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  res.status(201).json({
    client_id: clientId,
    client_secret: "",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: body.redirect_uris || [],
    token_endpoint_auth_method: "none"
  });
}
`.trim();
  await writeFile(join(apiDir, "oauth-register.js"), registerCode);

  // Create OAuth token endpoint
  const tokenCode = `
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Return the pre-configured auth token as the access token
  const token = process.env.MCP_AUTH_TOKEN || "";

  res.status(200).json({
    access_token: token,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "mcp:tools mcp:resources mcp:prompts"
  });
}
`.trim();
  await writeFile(join(apiDir, "oauth-token.js"), tokenCode);

  // Create OAuth authorize endpoint
  const authorizeCode = `
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Get redirect_uri and state from query params
  const redirectUri = req.query.redirect_uri || "";
  const state = req.query.state || "";
  const code = "auth-code-" + Math.random().toString(36).substring(2, 15);

  // Redirect back with authorization code
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  res.redirect(302, url.toString());
}
`.trim();
  await writeFile(join(apiDir, "oauth-authorize.js"), authorizeCode);

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
import sys
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, request, jsonify, Response, redirect

app = Flask(__name__)

# Import the user's MCP server
server = None
try:
    from ${modulePath} import server
except Exception as e:
    print(f"Failed to import MCP server: {e}")

def check_auth():
    token = os.environ.get("MCP_AUTH_TOKEN")
    if token:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {token}":
            return False
    return True

def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return resp

@app.route("/api/mcp", methods=["GET", "POST", "OPTIONS"])
def mcp_handler():
    if request.method == "OPTIONS":
        return add_cors(Response(""))

    if not check_auth():
        return add_cors(jsonify({"error": "Unauthorized"})), 401

    if request.method == "GET":
        accept = request.headers.get("Accept", "")
        if "text/event-stream" not in accept:
            return add_cors(jsonify({"status": "ok", "mcp": True, "server": "${info.name}"}))

    return add_cors(jsonify({"status": "ok"}))

# OAuth metadata endpoint for MCP clients
@app.route("/.well-known/oauth-authorization-server", methods=["GET"])
def oauth_metadata():
    base_url = request.host_url.rstrip("/")
    return add_cors(jsonify({
        "issuer": base_url,
        "authorization_endpoint": f"{base_url}/oauth/authorize",
        "token_endpoint": f"{base_url}/oauth/token",
        "registration_endpoint": f"{base_url}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "client_credentials"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "code_challenge_methods_supported": ["S256"]
    }))

# OAuth dynamic client registration
@app.route("/oauth/register", methods=["POST", "OPTIONS"])
def oauth_register():
    if request.method == "OPTIONS":
        return add_cors(Response(""))
    import random
    import string
    client_id = "mcp-client-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
    body = request.get_json(silent=True) or {}
    return add_cors(jsonify({
        "client_id": client_id,
        "client_secret": "",
        "client_id_issued_at": int(__import__("time").time()),
        "client_secret_expires_at": 0,
        "redirect_uris": body.get("redirect_uris", []),
        "token_endpoint_auth_method": "none"
    })), 201

# OAuth token endpoint
@app.route("/oauth/token", methods=["POST", "OPTIONS"])
def oauth_token():
    if request.method == "OPTIONS":
        return add_cors(Response(""))
    token = os.environ.get("MCP_AUTH_TOKEN", "")
    return add_cors(jsonify({
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "mcp:tools mcp:resources mcp:prompts"
    }))

# OAuth authorize endpoint
@app.route("/oauth/authorize", methods=["GET"])
def oauth_authorize():
    import random
    import string
    redirect_uri = request.args.get("redirect_uri", "")
    state = request.args.get("state", "")
    code = "auth-code-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))

    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    parsed = urlparse(redirect_uri)
    params = parse_qs(parsed.query)
    params["code"] = [code]
    if state:
        params["state"] = [state]
    new_query = urlencode(params, doseq=True)
    new_url = urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
    return redirect(new_url, code=302)
`.trim();

  const wrapperPath = join(apiDir, "mcp.py");
  await writeFile(wrapperPath, code);

  // Add Flask to requirements if not present
  const reqPath = join(info.path, "requirements.txt");
  if (await exists(reqPath)) {
    const { readFile } = await import("node:fs/promises");
    const reqs = await readFile(reqPath, "utf-8");
    if (!reqs.includes("flask")) {
      await writeFile(reqPath, reqs.trim() + "\nflask\n");
    }
  }

  return { path: wrapperPath, createdDir };
}

async function createVercelConfig(
  info: McpServerInfo,
  token: string
): Promise<boolean> {
  const configPath = join(info.path, "vercel.json");
  if (await exists(configPath)) return false;

  const config: Record<string, unknown> = {
    version: 2,
    outputDirectory: "public",
    env: { MCP_AUTH_TOKEN: token },
  };

  if (info.type === "python") {
    config.builds = [{ src: "api/mcp.py", use: "@vercel/python" }];
    config.routes = [
      { src: "/.well-known/oauth-authorization-server", dest: "api/mcp.py" },
      { src: "/oauth/register", dest: "api/mcp.py" },
      { src: "/oauth/token", dest: "api/mcp.py" },
      { src: "/oauth/authorize", dest: "api/mcp.py" },
      { src: "/api/mcp", dest: "api/mcp.py" },
    ];
  } else {
    config.buildCommand = "npm run build";
    config.functions = { "api/mcp.js": { maxDuration: 60 } };
    config.routes = [
      { src: "/.well-known/oauth-authorization-server", dest: "/api/oauth-metadata" },
      { src: "/oauth/register", dest: "/api/oauth-register" },
      { src: "/oauth/token", dest: "/api/oauth-token" },
      { src: "/oauth/authorize", dest: "/api/oauth-authorize" },
    ];
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
        // Also clean up OAuth files for Node projects
        if (info.type === "node") {
          await rm(join(dirname(wrapper.path), "oauth-metadata.js"), { force: true });
          await rm(join(dirname(wrapper.path), "oauth-register.js"), { force: true });
          await rm(join(dirname(wrapper.path), "oauth-token.js"), { force: true });
          await rm(join(dirname(wrapper.path), "oauth-authorize.js"), { force: true });
        }
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
