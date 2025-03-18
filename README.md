# AI Meta MCP Server

A dynamic MCP server that allows AI models to create and execute their own custom tools through a meta-function architecture. This server provides a mechanism for AI to extend its own capabilities by defining custom functions at runtime.

## Features

- **Dynamic Tool Creation**: AI can define new tools with custom implementations
- **Multiple Runtime Environments**: Support for JavaScript, Python, and Shell execution
- **Sandboxed Security**: Tools run in isolated sandboxes for safety
- **Persistence**: Store and load custom tool definitions between sessions
- **Flexible Tool Registry**: Manage, list, update, and delete custom tools
- **Human Approval Flow**: Requires explicit human approval for tool creation and execution

## Security Considerations

> ⚠️ **WARNING**: This server allows for dynamic code execution. Use with caution and only in trusted environments.

- All code executes in sandboxed environments
- Human-in-the-loop approval required for tool creation and execution
- Tool execution privileges configurable through environment variables
- Audit logging for all operations

## Installation

```bash
npm install ai-meta-mcp-server
```

## Usage

### Running the server

```bash
npx ai-meta-mcp-server
```

### Configuration

Environment variables:

- `ALLOW_JS_EXECUTION`: Enable JavaScript execution (default: true)
- `ALLOW_PYTHON_EXECUTION`: Enable Python execution (default: false)
- `ALLOW_SHELL_EXECUTION`: Enable Shell execution (default: false)
- `PERSIST_TOOLS`: Save tools between sessions (default: true)
- `TOOLS_DB_PATH`: Path to store tools database (default: "./tools.json")

### Running with Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-meta-mcp": {
      "command": "npx",
      "args": ["-y", "ai-meta-mcp-server"],
      "env": {
        "ALLOW_JS_EXECUTION": "true",
        "ALLOW_PYTHON_EXECUTION": "false",
        "ALLOW_SHELL_EXECUTION": "false"
      }
    }
  }
}
```

## Tool Creation Example

In Claude Desktop, you can create a new tool like this:

```
Can you create a tool called "calculate_compound_interest" that computes compound interest given principal, rate, time, and compounding frequency?
```

Claude will use the `define_function` meta-tool to create your new tool, which becomes available for immediate use.

## Architecture

The server implements the Model Context Protocol (MCP) and provides a meta-tool architecture that enables AI-driven function registration and execution within safe boundaries.

## License

MIT