import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs/promises";

/**
 * Interface for tool configuration in the JSON file
 */
interface ToolConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Interface for the JSON configuration file
 */
interface ConfigFile {
  [toolName: string]: ToolConfig;
}

// Helper functions for logging
const log = (...args: any[]): void => {
  console.error(...args);
};

const out = (...args: any[]): void => {
  console.log(...args);
};

class MCPToolCollector {
  private configFilePath: string;
  private servers: Record<string, Tool[]> = {};

  constructor(configFilePath: string) {
    this.configFilePath = configFilePath;
  }

  async loadConfig(): Promise<ConfigFile> {
    try {
      const configContent = await fs.readFile(this.configFilePath, 'utf-8');
      return JSON.parse(configContent) as ConfigFile;
    } catch (error) {
      log(`Error loading config file: ${error}`);
      throw new Error(`Failed to load config file: ${error}`);
    }
  }

  async getToolsFromServer(toolName: string, config: ToolConfig): Promise<Tool[]> {
    const mcp = new Client({ name: "mcp-tool-collector", version: "1.0.0" });
    let transport: StdioClientTransport | null = null;
    
    try {
      log(`Connecting to ${toolName} server...`);
      
      // Initialize transport with the provided command, args, and env
      const currentPath = process.env.PATH || '';
      
      // Process env variables, replacing ${PATH} with the actual PATH value
      const processedEnv: Record<string, string> = {};
      if (config.env) {
        for (const [key, value] of Object.entries(config.env)) {
          processedEnv[key] = value.replace('${PATH}', currentPath);
        }
      }
      
      // Set up environment with PATH
      const env = {
        ...processedEnv,
        PATH: processedEnv.PATH || currentPath,
      };
      
      // Create transport
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env,
        // Note: timeoutMs is handled internally by the transport
      });
      
      // Connect to the server
      await mcp.connect(transport);
      
      // List available tools
      const toolsResult = await mcp.listTools();
      const serverTools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      
      log(`Connected to ${toolName} server with ${serverTools.length} tools`);
      
      // Clean up
      await mcp.close();
      
      return serverTools;
    } catch (error) {
      log(`Failed to connect to ${toolName} server: ${error}`);
      // Try to close MCP client if it's still open
      try {
        await mcp.close();
      } catch (closeError) {
        log(`Error closing MCP client: ${closeError}`);
      }
      return [];
    }
  }

  async collectAllTools(): Promise<void> {
    const config = await this.loadConfig();
    for (const [toolName, toolConfig] of Object.entries(config)) {
      this.servers[toolName] = await this.getToolsFromServer(toolName, toolConfig);;
    }
  }

  outputToolsJson(): void {
    out(JSON.stringify(this.servers, null, 2));
  }
}

async function main() {
  if (process.argv.length < 3) {
    log("Usage: bun src/evals/get_tool_definitions.js src/evals/mcp_servers_for_evals.json");
    process.exit(1);
  }
  
  const configFilePath = process.argv[2];
  const collector = new MCPToolCollector(configFilePath);
  
  try {
    await collector.collectAllTools();
    collector.outputToolsJson();
    // Ensure the script terminates after printing
    process.exit(0);
  } catch (error) {
    log(`Error: ${error}`);
    process.exit(1);
  }
}

main();
