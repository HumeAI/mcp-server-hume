import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import {
  EvalScenario,
  commonInstructions,
} from "./types.js";
import {
  handler,
  mockDisplayResult,
  mockDisplayUse,
} from "./helpers.js";

export const quoteNarratorScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  // Inline dialogue content
  const dialogueContent = `Tom stood in the bathroom doorway, looking down at the mess on the floor. "I dropped my toothpaste!" said Tom, crestfallen. His roommate Sarah looked up from her book and smiled. "Don't worry about it," she said reassuringly. "I have an extra tube you can use." Tom brightened immediately. "You're a lifesaver," he replied with relief.`;

  return {
    roleplay: {
      name: "Quote Narrator",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
      },
      initialMessage:
        `Create a narrator voice. Then, using the narrator voice as a base, create voices for the narrator speaking as Tom and the narrator speaking as Sarah, and narrate the following passage: \n\n${dialogueContent}`,
      roleplayerPrompt: `You are roleplaying a user who is testing out a TTS model's ability to narrate audiobook dialogue.

      ${commonInstructions}
      
      End the roleplay when all three voices have been designed AND when all text in the passage has been sent to the TTS tool with the correct voices.
      `,
    },
    criteria: {
      subvoices: "The agent should do save_voice to create the narrator voice, call the tts tool with voiceName=<narrator> but a description that causes the narrator to sound like he is voicing the tom character, and use the generationId from that voice in the save_voice tool. Then likewise use voiceName=<narrator> but a description that causes the narrator to sound like he is voicing the sarah character, and use the generationId from that voice in the save_voice tool.",
      voice_assignments: "All voices in quotes should be assigned correctly to either the tom or sarah voice. All voices outside the quotes should be assigned to the narrator voice.",
      separate_utterances: "No utterance should contain both unquoted and quoted dialogue. Text inside quotation marks should be a different utterance than text outside.",
      formatting: "No utterance should contain quotation marks in its text. The quotation marks should be stripped."

    },
    maxTurns: 25,
  };
};
