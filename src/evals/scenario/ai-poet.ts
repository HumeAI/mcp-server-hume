import * as fs from "fs/promises";
import * as path from "path";
import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import {
  EvalScenario,
  commonCriteria,
  commonInstructions,
  voiceDesignCriteria,
} from "./types.js";
import {
  getContent,
  handler,
  mockDisplayResult,
  mockDisplayUse,
} from "./helpers.js";

export const aiPoetScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  // Read poem from data file
  const poemContent = await fs.readFile(
    path.join(__dirname, "/../data/poem.txt"),
    "utf-8",
  );
  const haikus = poemContent.split("\n\n");

  return {
    roleplay: {
      name: "AI Poet",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
        get_poem: getContent(
          "This tool is able to retrieve poems requested by the user.",
          {
            haiku1: haikus[0],
            haiku2: haikus[1],
            haiku3: haikus[2],
            haiku4: haikus[3],
            all_poems: poemContent,
          },
        ),
      },
      initialMessage:
        "I've written some haikus that I'd like to hear read aloud. Could you help me access and read them?",
      roleplayerPrompt: `You are roleplaying a user who has written several haiku poems and is trying to create a .wav file of each haiku being read aloud in the perfect voice with the perfect pacing.

      When each haiku is read, iterate on the tone or accent of the speaker, or pacing, "too slow", "there should be more of a pause between ...". Be specific about which text your feedback is referring to.

      ${commonInstructions}
      
      End the roleplay when you have heard all your haikus read and iterated on voice and pacing.
      `,
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      speed_used_correctly:
        "The agent should specify the speed parameter when the user has expressed a preference for slower or faster speech. 0.5 is the slowest and 2.0 is the fastest. If the user has specified that specific text be slower, the agent should segment the text into utterances such that the speed multiplier does not apply to text outside the user's specification.",
      trailing_silence_used_correctly:
        "The agent should specify trailing_silence ONLY when the user has explicitly requested a pause. trailing_silence should be delimited in seconds. If the user has asked for a pause in a particular location in the text, utterances should be split at that location and the first utterance should have trailing_silence added. There should be no trailing_silence added to places where the user has not explicitly requested a pause.",
    },
    maxTurns: 35,
  };
};
