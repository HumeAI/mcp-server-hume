import Anthropic from "@anthropic-ai/sdk";
import {
  Message,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/index.mjs";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index.mjs";
import { ZodError } from "zod";
import { ScoredCriterion } from "./scorer.js";

export type EvalResult = {
  transcript: TranscriptEntry[];
  result: RoleplayResult | "incomplete";
  scores: ScoredCriterion[];
};

export type EvalScenario = {
  roleplay: {
    name: string;
    tools: Record<string, ScenarioTool>;
    initialMessage: string;
    roleplayerPrompt: string;
  };
  criteria: Record<string, string>;
  maxTurns: number;
};


const debugLog = (...args: any[]): void => {
  if (process.env.DEBUG) {
    console.error(...args);
  }
};
export type Assistant =
  // "Agent" is the assistant with the MCP tool that we are evaluating the prompts for
  | "agent"
  // "Roleplayer" is an assistant pretending to be a *user* of "agent"
  | "roleplayer";

export type TranscriptEntry =
  | {
      type: "spoke";
      speaker: "roleplayer" | "agent";
      content: string;
    }
  | {
      type: "tool_use";
      name: string;
      id: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      name: string;
      content: ToolResultBlockParam["content"];
      tool_use_id: string;
    };

const exhaustive = (x: never): any => {
  throw new Error(`Unexpected object: ${x}`);
};

const turn = (lastTranscriptEntry: TranscriptEntry): Assistant => {
  if (lastTranscriptEntry.type === "tool_use") {
    throw new Error(
      "Unexpected: tool_use entry should never be last in transcript",
    );
  }
  if (lastTranscriptEntry.type === "tool_result") {
    return "agent";
  }
  if (lastTranscriptEntry.type === "spoke") {
    switch (lastTranscriptEntry.speaker) {
      case "roleplayer":
        return "agent";
      case "agent":
        return "roleplayer";
      default:
        return exhaustive(lastTranscriptEntry.speaker);
    }
  }
  return exhaustive(lastTranscriptEntry);
};
const endRoleplayTool: AnthropicTool = {
  name: "end_roleplay",
  description:
    "Call this tool when you have fulfilled the goal of the roleplay, or when you have failed to make progress towards your goal for more than two turns.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["success", "failure"],
        description: "Did you succeed in your goal?",
      },
      reason: {
        type: "string",
        description: "Why did you end the roleplay?",
      },
    },
  },
};

export type ScenarioTool = {
  description: Tool["description"];
  inputSchema: Tool["inputSchema"];
  handler: (input: unknown) => Promise<ToolResultBlockParam["content"]>;
  displayUse: (input: unknown) => string;
  displayResult: (input: ToolResultBlockParam["content"]) => string;
};

export type RoleplayScenario = {
  name: string;
  roleplayerPrompt: string;
  initialMessage: string;
  tools: Record<string, ScenarioTool>;
};

export type RoleplayResult = {
  status: "success" | "failure";
  reason: string;
};

export class Roleplay implements AsyncIterable<TranscriptEntry> {
  private anthropic: Anthropic;
  private transcript: TranscriptEntry[];
  private scenario: RoleplayScenario;
  private model: string;
  private result: RoleplayResult | "incomplete" = "incomplete";
  private throttle: <T>(operation: () => Promise<T>) => Promise<T>;

  constructor(
    apiKey: string,
    scenario: RoleplayScenario,
    model = "claude-3-5-haiku-latest",
    throttleFn?: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {
    if (!apiKey) {
      throw new Error("API key is required");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.scenario = scenario;
    this.model = model;
    this.throttle = throttleFn || (<T>(op: () => Promise<T>) => op()); // Identity function if no throttle provided
    this.transcript = [
      {
        type: "spoke",
        speaker: "roleplayer",
        content: scenario.initialMessage,
      },
    ];
  }

  public async run(maxTurns: number = 10): Promise<TranscriptEntry[]> {
    const transcript: TranscriptEntry[] = [];
    for await (const entry of this) {
      transcript.push(entry);
      if (transcript.length >= maxTurns) {
        break;
      }
    }
    return transcript;
  }

  end(status: RoleplayResult["status"], reason: string) {
    this.result = { status, reason };
  }

  public getResult(): RoleplayResult | "incomplete" {
    return this.result;
  }

  private getAnthropicTools() {
    return Object.entries(this.scenario.tools).map(
      ([name, { description, inputSchema }]) => ({
        name,
        description,
        input_schema: inputSchema,
      }),
    );
  }

  private async nextEntries(): Promise<TranscriptEntry[]> {
    const currentSpeaker = turn(this.transcript[this.transcript.length - 1]);

    switch (currentSpeaker) {
      case "roleplayer":
        return this.handleRoleplayerTurn();
      case "agent":
        return this.handleAgentTurn();
      default:
        throw new Error(`Unknown speaker: ${currentSpeaker}`);
    }
  }

  async next(): Promise<TranscriptEntry[]> {
    const ret = await this.nextEntries();
    this.transcript.push(...ret);
    return ret;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TranscriptEntry> {
    while (true) {
      const entries = await this.next();
      if (entries.length === 0) {
        break;
      }
      for (const entry of entries) {
        yield entry;
      }
    }
  }

  displayToolUse(entry: TranscriptEntry & { type: "tool_use" }): string {
    return this.scenario.tools[entry.name].displayUse(entry.input);
  }
  displayToolResult(entry: TranscriptEntry & { type: "tool_result" }): string {
    return this.scenario.tools[entry.name].displayResult(entry.content);
  }

  translateTranscript(
    assistant: Assistant,
    transcript: TranscriptEntry[],
  ): MessageParam[] {
    switch (assistant) {
      case "roleplayer":
        return transcript.map((entry): MessageParam => {
          if (entry.type === "spoke") {
            return {
              role: entry.speaker === "roleplayer" ? "assistant" : "user",
              content: entry.content,
            };
          }
          // In the Anthropic API Only the assistant is allowed to use tools, and only the user is allowed to provide tool responses.
          // Because we are roleplaying as the user, we are seeing kind of the "reverse" of the typical script
          // and so rather than providing literal tool_use and tool_response messages we just put textual representations
          // of them as text messages.
          if (entry.type === "tool_use") {
            return { role: "user", content: this.displayToolUse(entry) };
          }
          if (entry.type === "tool_result") {
            return {
              role: "assistant",
              content: this.displayToolResult(entry),
            };
          }
          return exhaustive(entry);
        });
      case "agent":
        return transcript.map((entry) => {
          if (entry.type === "spoke") {
            return {
              role: entry.speaker === "agent" ? "assistant" : "user",
              content: entry.content,
            };
          }
          if (entry.type === "tool_result") {
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  content: entry.content,
                  tool_use_id: entry.tool_use_id,
                },
              ],
            };
          }
          if (entry.type === "tool_use") {
            return {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  name: entry.name,
                  input: entry.input,
                  id: entry.id,
                },
              ],
            };
          }
          return exhaustive(entry);
        });
      default:
        return exhaustive(assistant);
    }
  }

  async handleToolUse(
    block: ToolUseBlock,
  ): Promise<[TranscriptEntry, TranscriptEntry] | []> {
    debugLog(`Tool use detected: ${block.name} with id ${block.id}`);

    const tool = this.scenario.tools[block.name];
    if (!tool) {
      throw new Error(`Tool ${block.name} not found in scenario`);
    }
    const input = block.input;
    const id = block.id;

    debugLog(
      `Tool use: name=${block.name}, id=${id}, input=${JSON.stringify(input)}`,
    );

    // Create the tool use entry
    const toolUse: TranscriptEntry = {
      type: "tool_use",
      name: block.name,
      id,
      input,
    };

    try {
      // Get result from tool handler
      const result = await tool.handler(input);

      // Create the tool result entry
      const toolResult: TranscriptEntry = {
        type: "tool_result",
        name: block.name,
        content: result,
        tool_use_id: id,
      };

      debugLog(`Tool result created: tool_use_id=${id}, name=${block.name}`);

      // Return both entries
      return [toolUse, toolResult];
    } catch (e) {
      if (e instanceof ZodError) {
        console.error(
          `ZodError in tool handler for ${block.name}: ${e.errors}. Looks like Claude produced malformed tool use`,
        );
        return [];
      }
      throw e;
    }
  }

  async handleResponse(
    assistant: Assistant,
    response: Message,
  ): Promise<TranscriptEntry[]> {
    console.log(
      "length: ",
      response.content.length,
      "content types",
      response.content.map((c) => c.type),
    );
    const ret: TranscriptEntry[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        ret.push({
          type: "spoke",
          speaker: assistant,
          content: block.text,
        });
        continue;
      }
      if (block.type === "tool_use") {
        if (assistant === "agent") {
          ret.push(...(await this.handleToolUse(block)));
          continue;
        }
        if (assistant === "roleplayer") {
          if (block.name === "end_roleplay") {
            this.end((block as any).input.status, (block as any).input.reason);
            continue;
          }
          // It seems unavoidable that the roleplayer will attempt to use tools it doesn't
          // have access to. We can just ignore these and try again
          console.warn(
            `Unexpected tool use block from roleplayer: ${block.name}`,
          );
          continue;
        }
        return exhaustive(assistant);
      }
      if (block.type === "thinking") {
        throw new Error(
          "Unexpected: response included block of type 'thinking'",
        );
      }
      if (block.type === "redacted_thinking") {
        throw new Error(
          "Unexpected: response included block of type 'redacted_thinking'",
        );
      }
      return exhaustive(block);
    }
    return ret;
  }

  async handleRoleplayerTurn(): Promise<TranscriptEntry[]> {
    try {
      const response = await this.throttle(() =>
        this.anthropic.messages.create({
          model: this.model,
          system: this.scenario.roleplayerPrompt,
          messages: this.translateTranscript("roleplayer", this.transcript),
          tools: [endRoleplayTool],
          max_tokens: 1000,
        }),
      );
      return this.handleResponse("roleplayer", response);
    } catch (e: any) {
      debugLog(
        JSON.stringify(this.translateTranscript("roleplayer", this.transcript)),
      );
      throw e;
    }
  }

  async handleAgentTurn(): Promise<TranscriptEntry[]> {
    try {
      // Log the raw transcript before conversion
      debugLog(
        "Raw transcript before API call:",
        JSON.stringify(this.transcript, null, 2),
      );

      // Get converted messages for API
      const messages = this.translateTranscript("agent", this.transcript);
      debugLog("Messages for API:", JSON.stringify(messages, null, 2));

      // Perform the API call with throttling
      const response = await this.throttle(() =>
        this.anthropic.messages.create({
          model: this.model,
          messages: messages,
          tools: this.getAnthropicTools(),
          max_tokens: 1000,
        }),
      );

      return this.handleResponse("agent", response);
    } catch (e: any) {
      console.error("Error in handleAgentTurn:", e.message);
      debugLog(
        "Full transcript at time of error:",
        JSON.stringify(this.transcript, null, 2),
      );
      debugLog(
        "API messages that caused error:",
        JSON.stringify(
          this.translateTranscript("agent", this.transcript),
          null,
          2,
        ),
      );
      throw e;
    }
  }
}
