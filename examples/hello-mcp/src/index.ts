/**
 * A simple MCP server example
 *
 * This server provides:
 * - A "hello" tool that greets users
 * - A "time" tool that returns the current time
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Create the server
export const server = new Server(
  {
    name: "hello-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "hello",
        description: "Say hello to someone",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name to greet",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "time",
        description: "Get the current time",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "hello": {
      const userName = (args as { name: string }).name;
      return {
        content: [
          {
            type: "text",
            text: `Hello, ${userName}! Welcome to MCP.`,
          },
        ],
      };
    }

    case "time": {
      return {
        content: [
          {
            type: "text",
            text: `Current time: ${new Date().toISOString()}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Export for hosty to use
export async function createMcpServer() {
  return server;
}

// Run with stdio transport when executed directly
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hello MCP server running on stdio");
}

main().catch(console.error);
