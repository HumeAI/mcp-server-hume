import { ContentBlock, MessageParam, TextBlockParam } from "@anthropic-ai/sdk/resources/index.mjs"
import { getHumeToolDefinitions, TTSCall, ttsSuccess } from "..";
import Anthropic from "@anthropic-ai/sdk";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages";
import serverDefs from "./server_defs.js";

const logDebug = (...args: any[]): void => {
  console.error(...args);
};

const cached = <T>(get: () => Promise<T>): (() => Promise<T>) => {
  let cache: T;
  let cacheSet = false;
  return async (): Promise<T> => {
    if (!cacheSet) {
      cache = await get();
      cacheSet = true;
    }
    return cache as T;
  };
};

const loadHumeTools = async (): Promise<McpTool[]> => {
  const toolList = await (cached(getHumeToolDefinitions)());

  const ret = toolList.map((tool: McpTool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  logDebug(`Loaded ${ret.length} tools from Hume MCP server`);
  return ret;
};

export type AvailableServer = keyof typeof serverDefs;

export const getAllTools = async (
  otherServers: AvailableServer[],
): Promise<McpTool[]> => {
  const otherServerTools = Object.entries(serverDefs)
    .filter(([k]) => otherServers.includes(k as keyof typeof serverDefs))
    .flatMap(([_, v]): Array<McpTool> => v);
  return [...otherServerTools, ...(await loadHumeTools())];
};

const toAnthropicTool = (tool: McpTool): AnthropicTool => {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
};

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export type EvalResult = {
  sessionName: string;
  scenarioName: string;
} & (EvalSuccess | EvalFailure);

type EvalSuccess = {
  status: 'success';
}

type EvalFailure = {
  status: 'failure';
  message: string;
  actual: ContentBlock[];
}

export const session = (sessionName: string, { tools, model }: { tools: AvailableServer[], model: string }) => {
  const transcript: MessageParam[] = []
  let toolUseCounter = 0;
  const results: EvalResult[] = []
  let lastResponse: ContentBlock[] = []

  return {
    userSays: (message: string) => {
      transcript.push({
        role: "user",
        content: message,
      });
    },
    toolUse: (toolName: string, input: unknown) => {
      transcript.push({
        role: "assistant",
        content: [{
          type: "tool_use",
          name: toolName,
          id: `${toolUseCounter++}`,
          input,
        }]
      });
      return {
        result: (resultContent: { content: string | Array<TextBlockParam>}) => {
          transcript.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: `${toolUseCounter - 1}`,
              content: resultContent.content,
            }]
          });
        }
      }
    },
    response: async (): Promise<ContentBlock[]> => {
      const anthropicResponse = await anthropic.messages.create({
        model: model,
        max_tokens: 2000,
        messages: transcript,
        tools: (await getAllTools(tools)).map(toAnthropicTool),
      });
      lastResponse = anthropicResponse.content;
      return anthropicResponse.content;
    },
    evaluate: (description: string, f: () => void) => {
      try {
        f();
        results.push({
          sessionName,
          scenarioName: description,
          status: 'success',
        });
      } catch (error) {
        logDebug(error)
        results.push({
          sessionName,
          scenarioName: description,
          status: 'failure',
          message: (error as any)?.message,
          actual: lastResponse,
        });
      }
    },
    ttsCall (input: TTSCall, output: {generationIds: Array<string>}) {
      return this.toolUse("tts", input).result(ttsSuccess(output.generationIds, input.utterances.map(u => u.text).join(" ")));
    },
    result: (): Array<EvalResult> => {
      return results
    }
  }
}

