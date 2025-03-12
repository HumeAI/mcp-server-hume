import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DESCRIPTIONS, HumeServer } from "../server.js";
import { ScenarioTool, TranscriptEntry } from "./roleplay.js";
import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import * as path from "path";
import * as os from "os";

export const getHumeMcpTools = async (args: {
  descriptions: typeof DESCRIPTIONS;
  handler: (toolName: string, input: unknown) => Promise<CallToolResult>;
  displayUse: (input: unknown) => string;
  displayResult: (result: ToolResultBlockParam["content"]) => string;
}): Promise<Record<string, ScenarioTool>> => {
  const { descriptions, handler, displayUse, displayResult } = args;
  const humeServer = new HumeServer({
    instantMode: true,
    claudeDesktopMode: process.env.CLAUDE_DESKTOP_MODE !== "false",
    workdir: process.env.WORKDIR ?? path.join(os.tmpdir(), "hume-tts"),
    log: console.error,
    humeApiKey: process.env.HUME_API_KEY!,
  });

  const server = new McpServer({
    name: "hume",
    version: "0.1.0",
  });

  humeServer.setupMcpServer(server);
  const tools = await humeServer.getToolDefinitions(server);
  const scenarioTools: Record<string, ScenarioTool> = {};

  const anthropicHandler =
    (toolName: string) =>
    async (input: unknown): Promise<ToolResultBlockParam["content"]> => {
      const mcpContent = (await handler(toolName, input)).content;
      const content: ToolResultBlockParam["content"] = [];
      for (const block of mcpContent) {
        if (block.type === "text") {
          content.push({
            type: "text",
            text: block.text,
          });
          continue;
        }
        throw new Error(`Unsupported block type: ${block.type}`);
      }
      return content;
    };
  for (const tool of tools) {
    scenarioTools[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: anthropicHandler(tool.name),
      displayUse: (input) => displayUse(input),
      displayResult: (result) => displayResult(result),
    };
  }

  return scenarioTools;
};

// Format transcript entries for display
export const prettyTranscriptEntry = (entry: TranscriptEntry): string => {
  switch (entry.type) {
    case "spoke":
      return `${entry.speaker}: ${entry.content}`;
    case "tool_use":
      return `Tool use (${entry.name} ${JSON.stringify(entry.input)}`;
    case "tool_result":
      return `Tool response (${entry.name} ${JSON.stringify(entry.content)})`;
  }
};
