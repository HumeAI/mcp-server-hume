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

export const aiPlaywrightScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  // Read dialogue content from data file
  const dialogueContent = await fs.readFile(
    path.join(__dirname, "/../data/play_dialogue.txt"),
    "utf-8",
  );

  return {
    roleplay: {
      name: "AI Playwright",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
        get_scene: getContent(
          "This tool is able to retrieve dialogue for the play.",
          {
            full_scene: dialogueContent,
          },
        ),
      },
      initialMessage:
        "I have a scene from my play at /with a mentor and apprentice discussing courage. Could you help me read it with different voices for each character?",
      roleplayerPrompt: `You are roleplaying a user who has written a play and wants to hear it performed with different character voices.

      You have a scene with two distinct characters: an elderly wise mentor and a young, enthusiastic apprentice discussing the concept of courage. You want the AI to help you access this dialogue and then read it using distinct voices that match each character.

      After the agent helps you find the dialogue, express interest in hearing it performed. When the agent uses the tts tool to perform the dialogue, provide feedback on the voices used.

      ${commonInstructions}
      
      End the roleplay when you've heard a satisfactory performance of the dialogue that captures both characters with appropriate voices.
      `,
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      diarization:
        "The agent should use save_voice to create a voice for each character, and each utterance dialogue belonging to that character should always be voiced with that voice.",
      one_speaker_per_request:
        "All utterances within a single tts call should be spoken by the same character. The agent should not mix voices within a single tts call.",
      only_speech:
        "The 'text' passed to the tts tool should contain only the text meant to be spoken. It should be stripped of any stage directions, or speaker names, or section titles",
    },
    maxTurns: 35,
  };
};
