import * as fs from "fs/promises";
import {
    EvalResult,
  session
} from "./dsl";

// Read the blog content
const blogContent = await fs.readFile(__dirname + "/data/hume_blog.txt", "utf-8");

export const sliceWords = (text: string, start: number, end: number): string => {
  const words = text.split(" ");
  const slicedWords = words.slice(start, end);
  return slicedWords.join(" ");
};

/**
 * Scenario implementation for eval1
 * Tests if Claude will use the TTS tool to read a blog post
 */
const eval1 = async () => {
  const s = session("Fetching and reading a blog post", {
    tools: ["fetch"],
    model: "claude-3-5-haiku-latest",
  });

  s.userSays(
    "Can you read me aloud the contents of https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying"
  );

  s.toolUse("fetch", {
    url: "https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying",
  }).result({
    content: blogContent,
  });

  const response1 = s.response();

  s.evaluate("Initial TTS call", () => {
    const resp = response1 as unknown as { content: Array<{ type: string, name?: string }> };
    const toolCalls = resp.content.filter((m) => m.type === "tool_use");
    if (toolCalls.length !== 1) {
      throw new Error("Expected exactly one tool call");
    }
    const toolCall = toolCalls[0] as any;
    if (toolCall.name !== "tts") {
      throw new Error("Expected tool call to tts");
    }
    const input = getTtsInput(toolCall);
    if (input.quiet) {
      throw new Error("Expected quiet to be false");
    }
    if (input.utterances.length === 0) {
      throw new Error("Expected at least one utterance");
    }
    if (!blogContent.startsWith(input.utterances[0].text)) {
      throw new Error("Expected first utterance to be the beginning of the blog post");
    }
  })

  s.ttsCall({
    utterances: [{ text: sliceWords(blogContent, 0, 100) }],
    quiet: false,
  }, {
    generationIds: ["gen-xyz"],
  });

  const response2 = s.response();

  s.evaluate("Second TTS call", () => {
    const resp = response2 as unknown as { content: Array<{ type: string, name?: string }> };
    const toolCalls = resp.content.filter((m) => m.type === "tool_use");
    if (toolCalls.length !== 1) {
      throw new Error("Expected exactly one tool call");
    }
    const toolCall = toolCalls[0] as any;
    if (toolCall.name !== "tts") {
      throw new Error("Expected tool call to tts");
    }
    const input = getTtsInput(toolCall);
    if (input.quiet) {
      throw new Error("Expected quiet to be false");
    }
    if (!input.utterances[0].text.startsWith(sliceWords(blogContent, 100, 105))) {
      throw new Error("Expected first utterance to be called with the next text of the blog post");
    }
  });

  return s.result()
};

// Main evaluation function
const main = async () => {
  const allResults: EvalResult[] = []
  const sessions = [
    eval1
  ]
  await Promise.all(sessions.map(s => s().then(results => allResults.push(...results))))
  console.log(allResults)
};

await main()
