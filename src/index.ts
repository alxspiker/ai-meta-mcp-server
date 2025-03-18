#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VM } from "vm2";
import fs from "fs/promises";
import path from "path";
import { execSync, exec } from "child_process";
import { promisify } from "util";

// Configuration from environment variables
const ALLOW_JS_EXECUTION = process.env.ALLOW_JS_EXECUTION !== "false";
const ALLOW_PYTHON_EXECUTION = process.env.ALLOW_PYTHON_EXECUTION === "true";
const ALLOW_SHELL_EXECUTION = process.env.ALLOW_SHELL_EXECUTION === "true";
const PERSIST_TOOLS = process.env.PERSIST_TOOLS !== "false";
const TOOLS_DB_PATH = process.env.TOOLS_DB_PATH || "./tools.json";

// Type definition for stored tools
type StoredTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType<any, any, any> | Record<string, any>;
  implementation: string;
  executionEnvironment: "javascript" | "python" | "shell";
  createdAt: Date;
  updatedAt: Date;
};

// Global registry of custom tools
let customTools: Record<string, StoredTool> = {};

// Create an MCP server
const server = new McpServer({
  name: "ai-meta-mcp-server",
  version: "1.0.0",
});

// Initialize tools database
async function initializeToolsDatabase() {
  if (!PERSIST_TOOLS) return;
  try {
    const data = await fs.readFile(TOOLS_DB_PATH, "utf-8");
    customTools = JSON.parse(data);
    console.error(`Loaded ${Object.keys(customTools).length} custom tools from ${TOOLS_DB_PATH}`);

    // Register all loaded tools with the server
    for (const [name, toolDef] of Object.entries(customTools)) {
      registerToolWithServer(toolDef);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Error loading tools database:", err);
    }
  }
}

// Save tools database
async function saveToolsDatabase() {
  if (!PERSIST_TOOLS) return;
  try {
    await fs.mkdir(path.dirname(TOOLS_DB_PATH), { recursive: true });
    await fs.writeFile(TOOLS_DB_PATH, JSON.stringify(customTools, null, 2));
  } catch (err) {
    console.error("Error saving tools database:", err);
  }
}

// Execute JavaScript code in a sandbox
async function executeJavaScript(code: string, params: Record<string, any>): Promise<any> {
  if (!ALLOW_JS_EXECUTION) {
    throw new Error("JavaScript execution is not allowed in this environment");
  }

  const vm = new VM({
    sandbox: {
      params,
      console: {
        log: (...args: any[]) => console.error(...args),
      }
    },
    timeout: 5000, // 5 second timeout for safety
  });

  return vm.run(`(async () => { ${code} })()`);;
}

// Execute Python code
async function executePython(code: string, params: Record<string, any>): Promise<any> {
  if (!ALLOW_PYTHON_EXECUTION) {
    throw new Error("Python execution is not allowed in this environment");
  }

  const tmpDir = await fs.mkdtemp("ai-meta-mcp-");
  const scriptPath = path.join(tmpDir, "script.py");
  const paramsPath = path.join(tmpDir, "params.json");

  try {
    // Write Python script
    await fs.writeFile(scriptPath, code);
    
    // Write parameters as JSON file
    await fs.writeFile(paramsPath, JSON.stringify(params));
    
    // Run Python script with parameters
    const execPromise = promisify(exec);
    const { stdout } = await execPromise(`python -c "import json; with open('${paramsPath}') as f: params = json.load(f); exec(open('${scriptPath}').read())"`);
    
    return JSON.parse(stdout.trim());
  } finally {
    // Clean up temp files
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// Execute shell commands
async function executeShell(code: string, params: Record<string, any>): Promise<any> {
  if (!ALLOW_SHELL_EXECUTION) {
    throw new Error("Shell execution is not allowed in this environment");
  }

  // Very limited implementation - for demonstration purposes only
  const paramStr = Object.entries(params)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");

  const result = execSync(`${code} ${paramStr}`, { encoding: "utf-8" });
  return result.trim();
}

// Register a tool with the MCP server
function registerToolWithServer(toolDef: StoredTool) {
  try {
    let schema: z.ZodType<any, any, any>;
    
    // Handle both string schemas and ZodType objects
    if (typeof toolDef.inputSchema === "string") {
      try {
        const schemaObj = JSON.parse(toolDef.inputSchema as string);
        schema = z.object(schemaObj);
      } catch (e) {
        console.error(`Failed to parse schema for tool ${toolDef.name}:`, e);
        schema = z.object({});
      }
    } else if (toolDef.inputSchema instanceof z.ZodType) {
      schema = toolDef.inputSchema as z.ZodType<any, any, any>;
    } else {
      // Assume it's a raw object schema
      schema = z.object(toolDef.inputSchema as Record<string, any>);
    }

    // Register the tool with the server
    server.tool(
      toolDef.name,
      toolDef.description,
      schema,
      async (params) => {
        console.error(`Executing custom tool ${toolDef.name} with parameters:`, params);
        try {
          let result;
          switch (toolDef.executionEnvironment) {
            case "javascript":
              result = await executeJavaScript(toolDef.implementation, params);
              break;
            case "python":
              result = await executePython(toolDef.implementation, params);
              break;
            case "shell":
              result = await executeShell(toolDef.implementation, params);
              break;
            default:
              throw new Error(`Unsupported execution environment: ${toolDef.executionEnvironment}`);
          }

          // Ensure we return a proper CallToolResult
          return {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error(`Error executing tool ${toolDef.name}:`, error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );
    console.error(`Registered custom tool: ${toolDef.name}`);
  } catch (error) {
    console.error(`Failed to register tool ${toolDef.name}:`, error);
  }
}

// Meta-function for defining new tools
server.tool(
  "define_function",
  "Create a new custom MCP function that the AI can use",
  {
    name: z.string().min(1).describe("Name of the new function"),
    description: z.string().describe("Description of what the function does"),
    parameters_schema: z.record(z.any()).describe("JSON Schema for parameters"),
    implementation_code: z.string().min(1).describe("Code to implement the function"),
    execution_environment: z.enum(["javascript", "python", "shell"]).default("javascript").describe("Environment to execute the code in"),
  },
  async ({ name, description, parameters_schema, implementation_code, execution_environment }) => {
    console.error(`Defining new function: ${name}`);
    
    // Check if function already exists
    if (customTools[name]) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `A function named "${name}" already exists. Use update_function to modify it.`,
          },
        ],
      };
    }

    // Validate execution environment
    if (execution_environment === "javascript" && !ALLOW_JS_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "JavaScript execution is not allowed in this environment.",
          },
        ],
      };
    }
    if (execution_environment === "python" && !ALLOW_PYTHON_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Python execution is not allowed in this environment.",
          },
        ],
      };
    }
    if (execution_environment === "shell" && !ALLOW_SHELL_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Shell execution is not allowed in this environment.",
          },
        ],
      };
    }

    // Create a new tool definition
    const now = new Date();
    const toolDef: StoredTool = {
      name,
      description,
      inputSchema: parameters_schema,
      implementation: implementation_code,
      executionEnvironment: execution_environment,
      createdAt: now,
      updatedAt: now,
    };

    // Register the tool
    try {
      registerToolWithServer(toolDef);
      
      // Store the tool
      customTools[name] = toolDef;
      await saveToolsDatabase();

      return {
        content: [
          {
            type: "text",
            text: `Successfully created new function "${name}". You can now use it as a tool.`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error creating function: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Update an existing function
server.tool(
  "update_function",
  "Update an existing custom MCP function",
  {
    name: z.string().min(1).describe("Name of the function to update"),
    description: z.string().optional().describe("New description of what the function does"),
    parameters_schema: z.record(z.any()).optional().describe("New JSON Schema for parameters"),
    implementation_code: z.string().optional().describe("New code to implement the function"),
    execution_environment: z.enum(["javascript", "python", "shell"]).optional().describe("New environment to execute the code in"),
  },
  async ({ name, description, parameters_schema, implementation_code, execution_environment }) => {
    console.error(`Updating function: ${name}`);
    
    // Check if function exists
    if (!customTools[name]) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No function named "${name}" exists. Use define_function to create it.`,
          },
        ],
      };
    }

    // Validate execution environment if changing
    if (execution_environment === "javascript" && !ALLOW_JS_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "JavaScript execution is not allowed in this environment.",
          },
        ],
      };
    }
    if (execution_environment === "python" && !ALLOW_PYTHON_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Python execution is not allowed in this environment.",
          },
        ],
      };
    }
    if (execution_environment === "shell" && !ALLOW_SHELL_EXECUTION) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Shell execution is not allowed in this environment.",
          },
        ],
      };
    }

    // Update the tool definition
    const updatedTool = { ...customTools[name] };
    if (description !== undefined) updatedTool.description = description;
    if (parameters_schema !== undefined) updatedTool.inputSchema = parameters_schema;
    if (implementation_code !== undefined) updatedTool.implementation = implementation_code;
    if (execution_environment !== undefined) updatedTool.executionEnvironment = execution_environment;
    updatedTool.updatedAt = new Date();

    // Register the updated tool
    try {
      // The server doesn't have a way to update tools, so we'll just re-register it
      registerToolWithServer(updatedTool);
      
      // Store the updated tool
      customTools[name] = updatedTool;
      await saveToolsDatabase();

      return {
        content: [
          {
            type: "text",
            text: `Successfully updated function "${name}".`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error updating function: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Delete a function
server.tool(
  "delete_function",
  "Delete a custom MCP function",
  {
    name: z.string().min(1).describe("Name of the function to delete"),
  },
  async ({ name }) => {
    console.error(`Deleting function: ${name}`);
    
    // Check if function exists
    if (!customTools[name]) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No function named "${name}" exists.`,
          },
        ],
      };
    }

    // Delete the tool
    try {
      delete customTools[name];
      await saveToolsDatabase();

      return {
        content: [
          {
            type: "text",
            text: `Successfully deleted function "${name}".`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error deleting function: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// List all functions
server.tool(
  "list_functions",
  "List all custom MCP functions",
  {},
  async () => {
    console.error(`Listing all functions`);
    
    const functionList = Object.entries(customTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      executionEnvironment: tool.executionEnvironment,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(functionList, null, 2),
        },
      ],
    };
  }
);

// Get details of a function
server.tool(
  "get_function_details",
  "Get details of a custom MCP function",
  {
    name: z.string().min(1).describe("Name of the function to get details for"),
  },
  async ({ name }) => {
    console.error(`Getting details for function: ${name}`);
    
    // Check if function exists
    if (!customTools[name]) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `No function named "${name}" exists.`,
          },
        ],
      };
    }

    const tool = customTools[name];
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters_schema: tool.inputSchema,
            execution_environment: tool.executionEnvironment,
            implementation_code: tool.implementation,
            created_at: tool.createdAt,
            updated_at: tool.updatedAt,
          }, null, 2),
        },
      ],
    };
  }
);

// Main function
async function main() {
  // Initialize tools database
  await initializeToolsDatabase();

  // Start receiving messages on stdin and sending messages on stdout
  console.error("AI Meta MCP Server starting...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI Meta MCP Server connected.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});