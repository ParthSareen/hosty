"""
A simple MCP server example in Python

This server provides:
- A "hello" tool that greets users
- A "time" tool that returns the current time
"""

from datetime import datetime
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("hello-mcp-python")


@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="hello",
            description="Say hello to someone",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "The name to greet"}
                },
                "required": ["name"],
            },
        ),
        Tool(
            name="time",
            description="Get the current time",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "hello":
        return [TextContent(type="text", text=f"Hello, {arguments['name']}! Welcome to MCP.")]
    elif name == "time":
        return [TextContent(type="text", text=f"Current time: {datetime.now().isoformat()}")]
    else:
        raise ValueError(f"Unknown tool: {name}")


if __name__ == "__main__":
    import asyncio
    from mcp.server.stdio import stdio_server

    asyncio.run(stdio_server(server))
