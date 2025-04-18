import { DESCRIPTIONS, getHumeToolDefinitions } from '../index.js';
import { ScenarioTool, TranscriptEntry } from './roleplay.js';
import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";

export const getHumeMcpTools = async (args: {
  descriptions: typeof DESCRIPTIONS,
  handler: (input: unknown) => Promise<ToolResultBlockParam['content']>,
  displayUse: (input: unknown) => string,
  displayResult: (result: ToolResultBlockParam['content']) => string
}): Promise<Record<string, ScenarioTool>> => {
  const {descriptions, handler, displayUse, displayResult} = args;
  const tools = await getHumeToolDefinitions(descriptions);
  const scenarioTools: Record<string, ScenarioTool> = {};
  
  for (const tool of tools) {
    scenarioTools[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
      displayUse: (input) => displayUse(input),
      displayResult: (result) => displayResult(result)
    }
  }
  
  return scenarioTools;
};

// Format transcript entries for display
export const prettyTranscriptEntry = (entry: TranscriptEntry): string => {
  switch (entry.type) {
    case 'spoke':
      return `${entry.speaker}: ${entry.content}`;
    case 'tool_use':
      return `Tool use (${entry.name} ${JSON.stringify(entry.input)}`;
    case 'tool_result':
      return `Tool response (${entry.name} ${JSON.stringify(entry.content)})`;
  }
};
