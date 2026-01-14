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
- [Vercel CLI](https://vercel.com/cli) (`npm i -g vercel`)
- Run `vercel login` once

## Usage

### Deploy

```bash
# Deploy current directory
hosty deploy

# Deploy specific path
hosty deploy ./my-mcp-server

# Deploy to production
hosty deploy --prod
```

After deploying, hosty outputs:
- The live URL
- A config snippet to paste into Claude Desktop
- A curl command to test it

### Check

Validate a project is a valid MCP server:

```bash
hosty check ./my-mcp-server
```

## What It Does

1. Detects your MCP server (Node or Python)
2. Wraps it for Vercel's serverless functions
3. Deploys with `vercel`
4. Generates a bearer token for auth
5. Outputs the config for your MCP client

## Supported Servers

### Node/TypeScript

Your project needs:
- `package.json` with `@modelcontextprotocol/sdk`
- Entry point exporting `server` or `createMcpServer()`

### Python

Coming soon.

## Example

See `examples/hello-mcp` for a simple MCP server you can deploy.

```bash
cd examples/hello-mcp
npm install
hosty deploy
```

## Config Output

After deploy, you get something like:

```json
{
  "mcpServers": {
    "hello-mcp": {
      "transport": {
        "type": "sse",
        "url": "https://hello-mcp.vercel.app/api/mcp"
      },
      "headers": {
        "Authorization": "Bearer abc123..."
      }
    }
  }
}
```

Paste this into `~/.claude/claude_desktop_config.json` and restart Claude.

## License

MIT
