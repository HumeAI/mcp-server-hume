import { ContentBlock, MessageParam, TextBlockParam } from "@anthropic-ai/sdk/resources/index.mjs"
import { getHumeToolDefinitions, TTSCall, ttsSuccess } from "../index.js";
import Anthropic from "@anthropic-ai/sdk";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages";
import serverDefs from "./server_defs.js";
import { z } from "zod";

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

  const ret = toolList.map((tool) => ({
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

export const or = (...fs: (() => void)[]): () => void => {
  const errors: Error[] = [];
  return () => {
    for (const f of fs) {
      try {
        f();
        return;
      } catch (error) {
        errors.push(error as Error);
      }
    }
    throw new Error(`All functions failed: ${errors.map(e => e.message).join(", ")}`);
  };
}

export class Session {
  private transcript: MessageParam[] = [];
  private toolUseCounter = 0;
  private results: EvalResult[] = [];
  private lastResponse: ContentBlock[] = [];
  private sessionName: string;
  private tools: AvailableServer[];
  private model: string;


  constructor(sessionName: string, { tools, model }: { tools: AvailableServer[], model: string }) {
    this.sessionName = sessionName;
    this.tools = tools;
    this.model = model;
  }

  userSays(message: string): void {
    this.transcript.push({
      role: "user",
      content: message,
    });
  }

  assistantSays(message: string): void {
    this.transcript.push({
      role: "assistant",
      content: message,
    });
  }

  toolUse(toolName: string, input: unknown) {
    this.transcript.push({
      role: "assistant",
      content: [{
        type: "tool_use",
        name: toolName,
        id: `${this.toolUseCounter++}`,
        input,
      }]
    });
    return {
      result: (resultContent: { content: string | Array<TextBlockParam> }) => {
        this.transcript.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: `${this.toolUseCounter - 1}`,
            content: resultContent.content,
          }]
        });
      }
    }
  }

  async judgeLastResponseYesOrNo(question: string) {
    const lastResponse = this.lastResponse;
    if (lastResponse.length === 0) {
      throw new Error("No response to judge");
    }

    const yesOrNoTool = {
        name: "yes_or_no",
        description: "Answer yes or no to the question",
        input_schema: {
          type: "object",
          properties: {
            answer: z.boolean(),
            explanation: z.string().optional().describe("If no, explain why"),
          }
        }
      }
    const anthropicResponse = await anthropic.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: `Answer the following question about the JSON chat transcript. Use the yes_or_no tool only. No textual response is needed.
            <question>${question}</question>\n<transcript>\n${JSON.stringify(lastResponse, null, 2)}\n</transcript>`,
        }]
      }],
      tools: [yesOrNoTool as AnthropicTool],
      tool_choice: { type: "tool", "name": "yes_or_no" }
    });

    const toolCall = anthropicResponse.content.find((b) => b.type === "tool_use");
    if (!toolCall) throw new Error("Judge error: judgeLastResponse response did not contain tool use");
    const input = z.object(yesOrNoTool.input_schema.properties).parse(toolCall.input);
    if (!input.answer) {
      if (!input.explanation) {
        throw new Error("Judge error: failed with no explanation");
      }
      throw new Error(`${input.explanation}`);
    }
  }

  async response(): Promise<ContentBlock[]> {
    const anthropicResponse = await anthropic.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: this.transcript,
      tools: (await getAllTools(this.tools)).map(toAnthropicTool),
    });
    this.lastResponse = anthropicResponse.content;
    return anthropicResponse.content;
  }

  evaluate(description: string, f: () => void): void {
    try {
      f();
      this.results.push({
        sessionName: this.sessionName,
        scenarioName: description,
        status: 'success',
      });
    } catch (error) {
      logDebug(error)
      this.results.push({
        sessionName: this.sessionName,
        scenarioName: description,
        status: 'failure',
        message: (error as any)?.message,
        actual: this.lastResponse,
      });
    }
  }

  ttsCall(input: TTSCall, output: { generationIds: Array<string> }) {
    return this.toolUse("tts", input).result(ttsSuccess(output.generationIds, input.utterances.map(u => u.text).join(" ")));
  }

  result(): Array<EvalResult> {
    return this.results;
  }

  async fork(forkName: string, callback: (session: Session) => Promise<void>): Promise<Session> {
    // Create a forked session with a new name
    const forkedSession = new Session(`${this.sessionName}:${forkName}`, {
      tools: this.tools,
      model: this.model
    });

    // Copy the transcript from the current session
    forkedSession.transcript = [...this.transcript];
    forkedSession.toolUseCounter = this.toolUseCounter;

    // Execute the callback with the forked session
    await callback(forkedSession);

    // Combine results from the forked session into the original
    this.results.push(...forkedSession.results);

    return forkedSession;
  }
}

export const session = (sessionName: string, options: { tools: AvailableServer[], model: string }): Session => {
  return new Session(sessionName, options);
}

