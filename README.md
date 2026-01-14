# hosty

One-command deploy any MCP server to Vercel.

```bash
hosty deploy ./my-mcp-server
```

That's it. Your MCP server is now live and ready to use.

## Install

```bash
npm install -g hosty
```

Also need:
- [Vercel CLI](https://vercel.com/cli) - `npm i -g vercel`
- Run `vercel login` once

## Usage

```bash
hosty deploy [path]     # Deploy an MCP server
hosty list              # Show deployed servers
hosty config <name>     # Get config for a server
hosty check [path]      # Validate a project
```

### Deploy

```bash
hosty deploy                    # Deploy current directory
hosty deploy ./my-mcp-server    # Deploy specific path
hosty deploy --prod             # Deploy to production
```

After deploying, hosty:
- Outputs the live URL
- Outputs config to paste into Claude Desktop
- Saves to `~/.hosty/servers.json` for later

### List & Config

```bash
hosty list              # See all deployed servers
hosty config my-server  # Get Claude Desktop config again
```

## How Auth Works

When you deploy, hosty:

1. Generates a random 64-character bearer token
2. Sets it as `AUTH_TOKEN` env var in your Vercel deployment
3. The deployed wrapper validates incoming requests against this token
4. Saves the token locally so you can retrieve it later

Your MCP clients send `Authorization: Bearer <token>` header with each request.

## What Gets Deployed

hosty creates a temporary Vercel serverless wrapper (`api/mcp.js`) that:
- Exposes your MCP server over HTTP/SSE
- Handles CORS
- Validates the bearer token
- Provides a health check endpoint

After deployment, hosty cleans up all generated files.

## Supported Servers

### Node/TypeScript

Your project needs:
- `package.json` with `@modelcontextprotocol/sdk`
- Entry point that exports `server` or `createMcpServer()`

```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export const server = new Server({ name: "my-server", version: "1.0.0" }, {
  capabilities: { tools: {} }
});

// ... register handlers
```

### Python

Coming soon.

## Example

```bash
cd examples/hello-mcp
npm install
hosty deploy
```

## Output

After `hosty deploy`, you get:

```
MCP server is live

URL: https://hello-mcp-abc123.vercel.app
MCP: https://hello-mcp-abc123.vercel.app/api/mcp
Key: a1b2c3d4...

Saved to ~/.hosty/servers.json

──────────────────────────────────────────────────

Add to Claude Desktop config:

{
  "mcpServers": {
    "hello-mcp": {
      "transport": {
        "type": "sse",
        "url": "https://hello-mcp-abc123.vercel.app/api/mcp"
      },
      "headers": {
        "Authorization": "Bearer a1b2c3d4..."
      }
    }
  }
}
```

## License

MIT
