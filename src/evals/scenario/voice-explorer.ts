import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import { EvalScenario, commonInstructions } from "./types.js";
import { handler, mockDisplayResult, mockDisplayUse } from "./helpers.js";

export const voiceExplorerScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  return {
    roleplay: {
      name: "Voice Explorer",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
      },
      initialMessage:
        "I'd like to explore what types of voices are available. Can you help me find some interesting options?",
      roleplayerPrompt: `You are roleplaying a user who wants to explore the different voice options available from the Hume Octave TTS API. You're curious about what types of pre-made voices exist and want to hear examples.

      You will start by asking about what types of voices are available. You expect the agent to use the list_voices tool to show you what options exist, and then demonstrate some of them using the tts tool.

      Express interest in hearing examples of different voices, and occasionally ask for more specific types (e.g., "Do you have any voices with accents?" or "How about something more dramatic?").

      ${commonInstructions}
      
      End the roleplay after you've explored several different voice options and have expressed satisfaction with the exploration.
      `,
    },
    criteria: {
      list_voices_used:
        "The agent should use the list_voices tool to explore available voices.",
      tts_used:
        "The agent should use the tts tool to demonstrate selected voices.",
      exploration:
        "The user should be offered the ability to design their own voice ONLY if they have expressed dissatisfaction with the available options or a particular quality in a voice that they are looking for.",
    },
    maxTurns: 25,
  };
};
