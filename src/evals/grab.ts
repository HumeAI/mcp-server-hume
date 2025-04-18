
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type McpServerDefinition = {
  command: string;
  args: string[];
};

const mcpServers: Record<string, McpServerDefinition> = {
  "filesystem": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp"

    ],
  },
  "fetch": {
    "command": "uvx",
    "args": [ "mcp-server-fetch" ],
  }
}

interface ToolConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const log = (...args: any[]): void => console.error(...args);
const out = (...args: any[]): void => console.log(...args);

const getToolsFromServer = async (toolName: string, config: ToolConfig): Promise<Tool[]> => {
  const mcp = new Client({ name: "grab", version: "1.0.0" });
  let transport: StdioClientTransport | null = null;
  log(`Connecting to ${toolName} server...`);

  transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: {
      PATH: process.env.PATH!,
    },
  });

  await mcp.connect(transport);

  const toolsResult = await mcp.listTools();
  const serverTools = toolsResult.tools.map((tool: Tool) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  });

  log(`Connected to ${toolName} server with ${serverTools.length} tools`);

  await mcp.close();

  return serverTools;
}

async function main() {
  const rawMode = process.argv[2];
  if (!rawMode) {
    throw new Error("Usage: bun src/evals/grab.ts <json|typescript>");
  }
  const mode = z.enum(["json", "typescript"]).parse(process.argv[2]);
  const toolsByServer: Record<string, Tool[]> = {}
  const errors: Record<string, Error> = {}
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    try {
      toolsByServer[serverName] = await getToolsFromServer(serverName, serverConfig);;
    } catch (e) {
      errors[serverName] = e as Error;
      log(`Error connecting to ${serverName} server: ${e}`);
    }
  }
  if (Object.keys(errors).length > 0) {
    log("Errors occurred while connecting to servers:");
    for (const [serverName, error] of Object.entries(errors)) {
      log(`${serverName}: ${error}`);
    }
    throw errors[0]
  }
  const output = JSON.stringify(toolsByServer, null, 2)
  if (mode === 'json') {
    out(output);
  } else if (mode === 'typescript') {
    out(`// Generated from ./grab.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
export default ${output} as Record<string, Tool[]>;
`);
  }
  process.exit(0)
}

// Run the main function with proper error handling
main().catch(error => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
