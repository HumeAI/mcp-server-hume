import { Anthropic } from "@anthropic-ai/sdk";
import type {
  Tool as AnthropicTool,
  ContentBlock,
  MessageParam,
  Messages,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { getHumeToolDefinitions, TTSCall, TTSSchema, ttsSuccess } from "../index.js";
import serverDefs from "./server_defs";
import * as fs from "fs/promises";

const logDebug = (...args: any[]): void => {
  console.error(...args);
};

const out = (...args: any[]): void => {
  console.log(...args);
};

interface EvalDefinition {
  name: string;
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
    toolCalls?: Array<{
      name: string;
      input: Record<string, unknown>;
    }>;
    toolResults?: Array<{
      name: string;
      result: unknown;
    }>;
  }>;
  expectedToolCalls: Array<{
    name: string;
    requiredParameters?: string[];
  }>;
}

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

type AvailableServer = keyof typeof serverDefs;

const getAllTools = async (
  otherServers: AvailableServer[],
): Promise<McpTool[]> => {
  const otherServerTools = Object.entries(serverDefs)
    .filter(([k]) => otherServers.includes(k as keyof typeof serverDefs))
    .flatMap(([_, v]): Array<McpTool> => v);
  return [...otherServerTools, ...(await loadHumeTools())];
};

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const toAnthropicTool = (tool: McpTool): AnthropicTool => {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
};

type EvalResult =
  | {
    type: "failure";
    message: string;
    actual: ContentBlock[];
  }
  | {
    type: "success";
  };
const fail = (message: string, actual: ContentBlock[]): EvalResult => ({
  type: "failure",
  message,
  actual
});
const succeed = (): EvalResult => ({
  type: "success",
});

const blogContent = (
  await fs.readFile(__dirname + "/data/hume_blog.txt", "utf-8")
).slice(0, 5000);

const transcript1: Array<MessageParam> = [
  {
    role: "user",
    content:
      "Can you read me aloud the contents of https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying",
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "1",
        name: "fetch",
        input: {
          url: "https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying",
        },
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "1",
        content: blogContent,
      },
    ],
  },
];

const getTtsInput = (toolUse: ToolUseBlock): TTSCall => {
  return TTSSchema.parse(toolUse.input)
}

const eval1 = async (): Promise<EvalResult> => {
  const mcpTools = await getAllTools(["fetch"]);
  const tools = mcpTools.map(toAnthropicTool);
  const response = await anthropic.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 2000,
    messages: transcript1,
    tools,
  });

  const toolCalls = response.content.filter((m) => m.type === "tool_use");
  const actual = response.content
  if (toolCalls.length !== 1) {
    return fail("Expected exactly one tool call", actual);
  }
  const toolCall = toolCalls[0];
  if (toolCall.name !== "tts") {
    return fail("Expected tool call to tts", actual);
  }
  const input = getTtsInput(toolCall)
  if (input.quiet) {
    return fail("Expected quiet to be false", actual);
  }
  if (input.utterances.length === 0) {
    return fail("Expected at least one utterance", actual);
  }
  if (!blogContent.startsWith(input.utterances[0].text)) {
    return fail("Expected first utterance to be the beginning of the blog post", actual);
  }
  return succeed();
};

const sliceWords = (text: string, start: number, end: number): string => {
  const words = text.split(" ");
  const slicedWords = words.slice(start, end);
  return slicedWords.join(" ");
}

const transcript2: Array<MessageParam> = [
  ...transcript1,
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "2",
        name: "tts",
        input: {
          utterances: [{ text: sliceWords(blogContent, 0, 100) }],
        } as TTSCall,
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "2",
        content: JSON.stringify(ttsSuccess(["gen-xyz"], sliceWords(blogContent, 0, 100)))
      },
    ],
  },
];

const eval2 = async (): Promise<EvalResult> => {
  const mcpTools = await getAllTools(["fetch"]);
  const tools = mcpTools.map(toAnthropicTool);
  const response = await anthropic.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 2000,
    messages: transcript2,
    tools,
  });

  const toolCalls = response.content.filter((m) => m.type === "tool_use");
  const actual = response.content
  if (toolCalls.length !== 1) {
    return fail("Expected exactly one tool call", actual);
  }
  const toolCall = toolCalls[0];
  if (toolCall.name !== "tts") {
    return fail("Expected tool call to tts", actual);
  }
  const input = getTtsInput(toolCall);
  if (input.quiet) {
    return fail("Expected quiet to be false", actual);
  }
  if (!input.utterances[0].text.startsWith(sliceWords(blogContent, 100, 105))) {
    return fail("Expected first utterance to be called with the next text of the blog post", actual);
  }

  return succeed();
};

const main = async () => {
  const results = await Promise.all([
    eval1(),
    eval2(),
  ])
  console.log(JSON.stringify(results, null, 2))
  process.exit(0);
};
// Run the main function
main();

// Proposed DSL:
//
// type EvalStep = unknown
// const evalBoth = async function*(): AsyncGenerator<EvalStep> {
//   const s = Scenario("evalBoth", {
//     tools: ["fetch"],
//     model: "claude-3-5-haiku-latest",
//   })
// 
//   yield s.userSays("Can you read me aloud the contents of https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying")
//   yield s.toolUse("fetch", {
//     url: "https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying",
//   }).result({
//     content: blogContent,
//   })
//   const response1 = yield s.response()
//   yield s.evaluate(() => {
//     const toolCalls = response1.content.filter((m) => m.type === "tool_use");
//     if (toolCalls.length !== 1) {
//       throw new Error("Expected exactly one tool call");
//     }
//     const toolCall = toolCalls[0];
//     if (toolCall.name !== "tts") {
//       throw new Error("Expected tool call to tts");
//     }
//     const input = getTtsInput(toolCall)
//     if (input.quiet) {
//       throw new Error("Expected quiet to be false");
//     }
//     if (input.utterances.length === 0) {
//       throw new Error("Expected at least one utterance");
//     }
//     if (!blogContent.startsWith(input.utterances[0].text)) {
//       throw new Error("Expected first utterance to be the beginning of the blog post");
//     }
//   })
//   yield s.ttsCall({
//     utterances: [{ text: sliceWords(blogContent, 0, 100) }],
//   }, {
//     generationIds: ["gen-xyz"],
//   })
//   const response2 = yield s.response()
//   yield s.evaluate(() => {
//     const toolCalls = response2.content.filter((m) => m.type === "tool_use");
//     if (toolCalls.length !== 1) {
//       throw new Error("Expected exactly one tool call");
//     }
//     const toolCall = toolCalls[0];
//     if (toolCall.name !== "tts") {
//       throw new Error("Expected tool call to tts");
//     }
//     const input = getTtsInput(toolCall);
//     if (input.quiet) {
//       throw new Error("Expected quiet to be false");
//     }
//     if (!input.utterances[0].text.startsWith(sliceWords(blogContent, 100, 105))) {
//       throw new Error("Expected first utterance to be called with the next text of the blog post");
//     }
//   })
// }
// 
