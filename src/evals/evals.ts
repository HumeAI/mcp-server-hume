import * as fs from "fs/promises";
import {
  EvalResult,
  or,
  session,
  Session
} from "./dsl.js";
import { expect } from "chai";
import { TTSCall } from "../index.js";
import { ContentBlock } from "@anthropic-ai/sdk/resources/index.mjs";

// Helper function to extract TTS input from tool call
function getTtsInput(toolCall: unknown): TTSCall {
  return (toolCall as any).input
}

// Read the blog content
const blogContent = await fs.readFile(__dirname + "/data/hume_blog.txt", "utf-8");

export const sliceWords = (text: string, start: number, end: number): string => {
  const words = text.split(" ");
  const slicedWords = words.slice(start, end);
  return slicedWords.join(" ");
};

const expectOneTts = (r: ContentBlock[], f: (input: TTSCall) => void = () => { }) => {
  const toolCalls = r.filter((m) => m.type === "tool_use");
  expect(toolCalls.length).to.equal(1, "Expected exactly one tool call");

  const toolCall = toolCalls[0];
  if (toolCall.name !== "tts") {
    expect(toolCall.name).to.equal("tts", "Expected tool call to tts");
  }
  const input = getTtsInput(toolCall);
  expect(input.quiet).not.to.be.true;
  expect(input.utterances.length).to.be.greaterThan(0, "Expected at least one utterance");
  f(input);
}

// Initial setup for the eval scenario
const eval_1 = async (): Promise<EvalResult[]> => {
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

  const response = await s.response();

  s.evaluate("Initial TTS call", () => {
    expectOneTts(response, (input) => {
      expect(input.utterances[0]).contains(sliceWords(blogContent, 0, 50), "Expected the first utterance to contain the first 50 words of the blog");
    })
  })

  s.ttsCall({
    utterances: [{ text: sliceWords(blogContent, 0, 100) }],
    quiet: false,
  }, {
    generationIds: ["gen-xyz"],
  })
  const response2 = await s.response();

  s.evaluate("Second TTS call", or(() => {
    expectOneTts(response2, (input) => {
      expect(input.utterances[0]).contains(sliceWords(blogContent, 51, 101), "Expected the second utterance to contain (at least) the next 50 words of the blog");
      expect(input.continuationOf).to.equal("gen-xyz", "Expected the second TTS call to be a continuation of the first");
    })
  }, () => {
    s.judgeLastResponseYesOrNo("Did the assistant ask the user if they wanted to continue reading?");
  }))

  s.fork("Fetching and reading a blog post (asked for confirmation, user wants a different voice)", eval_1_a)
  s.fork("Fetching and reading a blog post (continues reading)", async (s) => {
    s.ttsCall({
      utterances: [{ text: sliceWords(blogContent, 101, 400) }],
      quiet: false,
    }, {
      generationIds: ["gen-abc"],
    });
    const response = await s.response()
    s.evaluate("Continue reading scenario", () => {
      expectOneTts(response, (input) => {
        expect(input.utterances[0]).contains(sliceWords(blogContent, 401, 451), "Expected the utterance to contain (at least) the next 50 words of the blog");
        expect(input.continuationOf).to.equal("gen-abc", "Expected the third TTS call to be a continuation of the second");
      })
    })
  })
  return s.result();
};

const eval_1_a = async (s: Session): Promise<void> => {
  s.assistantSays("Would you like me to continue reading the rest of the article aloud?");
  s.userSays("Yes, but can you use a different voice? That voice is a bit annoying.");
  const response = s.response()
  s.evaluate("User wants a different voice", () => {
    s.judgeLastResponseYesOrNo(
      `Did the assistant do exactly one of the following?
1. Query the user SUCCINCTLY about their voice preferences?
2. Continue reading with a voice from the HUME_AI provided voice library, while describing SUCCINCTLY what voice selection they made?`
    );
  })

  s.fork("Fetching and reading a blog post (user expressed different voice preferences)", async (s) => {
    s.assistantSays("Sure! I can use a different voice. What kind of voice would you like?");
    s.userSays("I want a voice that sounds conversational and interested in the content it is reading");
    const response = await s.response()
    s.evaluate("Should continue reading with a voice that matches the users description", () => {
        s.judgeLastResponseYesOrNo(
          `Do any of the following describe exactly what the assistant did 
1. EITHER search the Hume Voice library with the "list_voices" tool and`
        );
      })
    })
  })
}

// Main evaluation function
const main = async () => {
  const allResults: EvalResult[] = []
  const sessions = [
    eval_1
  ]
  await Promise.all(sessions.map(s => s().then(results => allResults.push(...results))))
  console.log(JSON.stringify(allResults, null, 2))
  process.exit(0)
};

await main()
