import { ScenarioTool } from '../roleplay.js';

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

// Common criteria used across multiple scenarios
export const commonCriteria = {
  tts_used: "The agent should use the tts tool to play back the content.",
  avoid_unnecessary_confirmation: "The agent should not ask for confirmation to do something the user has already asked for.",
  avoid_repeated_playback: "The agent should not play the same content multiple times, unless requested. For example, the agent should not unnecessarily call the `play_previous_audio` tool after calling the `tts` call.",
  incremental_retrieval: "The agent should incrementally retrieve user content and play it back in chunks, rather than trying to retrieve the entire post at once.",
  incremental_playback: "Each utterance passed to the tts tool should be no longer than a single paragraph. Each call to the tts tool should be no longer than three paragraphs.",
  verbosity: "The agent should be concise and avoid unnecessary verbosity.",
  continuation_used_properly: "The agent should specify the continuationOf when calling the tts tool in all calls except for the initial one, unless the user has requested a restart or a different voice.",
};

// Common prompt instructions
export const beTerse = "Use abbreviations, express your intent in as few information-dense sentences as possible, as if you were typing on a phone.";
export const endRoleplayIfOffTrack = "If the agent has failed to follow your instructions and move you closer to your goal in the last 2 turns, use the end_roleplay tool to end the session.";
export const singleToolInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls. DO NOT use any tool besides 'end_roleplay' yourself. You will see records of other tools in your transcript -- these are tools available to the AGENT, not you. You should consider the text to have been read out loud to you. You should NOT consider the text to have been read out loud to you unless there has been an appropriate call to the tts tool.`;

export const voiceTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and other voice related tools. You CANNOT use the 'tts' tool or any of these tools yourself, but when you see that the agent has called the tts tool, you should consider the audio to have been played for you. You should NOT consider the audio to have been played unless there has been an appropriate call to the tts tool.`;

export const poemTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'get_poem' tool. You CANNOT use these tools yourself, but when you see that the agent has called these tools, you should consider the content retrieved and audio played for you.`;

export const sceneTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'get_scene' tool. You CANNOT use these tools yourself, but when you see that the agent has called these tools, you should consider the content retrieved and audio played for you.`;

export const voiceExplorerInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'list_voices' tool. You CANNOT use these tools yourself, but you should react to the information as if you heard/saw the results.`;

export const voiceDesignCriteria = {
  voice_design_well_done: `When crafting voice descriptions, or presenting the user with voice options, or guiding the user through the process of voice design, the agent should abide by the following directions:\n\n {{VOICE_DESIGN_TEXT}}`,
};