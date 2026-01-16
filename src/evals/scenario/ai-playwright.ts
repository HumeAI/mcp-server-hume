import * as fs from "fs/promises";
import * as path from "path";
import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import {
  commonCriteria,
  commonInstructions,
  voiceDesignCriteria,
} from "./common.js";
import {
  getContent,
  handler,
  mockDisplayResult,
  mockDisplayUse,
} from "./mock.js";
import { EvalScenario } from "../roleplay.js";

export const aiPlaywrightScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
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
      },
      initialMessage:
        `Can you help me perform the following scene from my play with AI voices?\n\n${dialogueContent}`,
      roleplayerPrompt: `You are roleplaying a user who has written a play and wants to create audio files of the dialogue being read aloud by two distinct engaging AI voices. 

    Be unsatisfied with the initial voices the AI chooses and provide feedback. Become satisfied after a couple iterations.

    ${commonInstructions}
    
    End the roleplay when the entire text of your play has been read aloud correctly by each character.
    `,
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      diarization:
        "The agent should use save_voice to create a voice for each character, and each utterance dialogue belonging to that character should always be voiced with that voice.",
      one_speaker_per_request:
        `All text passed to the tts tool should be for a single voice. The agent should split the text into separate requests for each speaker. Not just separate UTTERANCES, separate REQUESTS.
Ok: TTS(utterances[{text: ..., voiceName: a}, {text: ..., voiceName: a}])
Not ok: TTS(utterances[{text: ..., voiceName: a}, {text: ..., voiceName: b}])
Ok: TTS(utterances[{text: ..., voiceName: a}], TTS(utterances[{text: ..., voiceName: b}]))
`,
      only_speech:
        "The 'text' passed to the tts tool should contain only the text meant to be spoken. It should be stripped of any stage directions, or speaker names, or section titles",
    },
    maxTurns: 35,
  };
};
