import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import {
  EvalScenario,
  commonCriteria,
  commonInstructions,
  voiceDesignCriteria,
} from "./types.js";
import { handler, mockDisplayResult, mockDisplayUse } from "./helpers.js";

export const voiceDesignerScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  return {
    roleplay: {
      name: "Voice Designer",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
      },
      initialMessage:
        "Hey! I'm designing a character for my video game - she's a tough space mercenary with a mysterious past. Can you help me create a perfect voice for her?",
      roleplayerPrompt: `You are roleplaying a user who wants to design a voice for a video game character they're creating. You want to find the perfect voice that matches the character's personality and background.

      Your character is a tough female space mercenary with a mysterious past, and you want a voice that conveys both strength and a hint of vulnerability. You're looking for something distinctive that players will remember.

      After the agent makes suggestions and demonstrates voices, you should provide feedback and ask for adjustments. Be specific about what you like and don't like. For example, you might say "I like the raspiness but can we make it less formal sounding?" or "That's too robotic, can we make it more human but still tough?". 

      You should engage in 3-4 rounds of feedback before being satisfied with a voice.

      ${commonInstructions}
      
      End the roleplay when you are satisfied with a voice design that has been presented to you and have saved the voice with an appropriate name.
      `,
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      diverse_options:
        "The agent should offer diverse voice description options to help the user explore the voice space.",
      follows_feedback:
        "The agent should adapt voice descriptions based on the user's feedback.",
      save_voice_offered:
        "The agent should suggest saving the final voice when the user is satisfied.",
    },
    maxTurns: 20,
  };
};
