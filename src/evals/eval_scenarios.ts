import * as fs from 'fs/promises';
import * as path from 'path';
import { DESCRIPTIONS, handlePlayPreviousAudio, playPreviousAudioSuccess, TTSSchema, ttsSuccess } from '../index.js';
import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import { ScenarioTool } from './roleplay.js';
import { getHumeMcpTools } from './utils.js';
import { v4 as uuid } from 'uuid';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Common prompt instructions
const beTerse = "Use abbreviations, express your intent in as few information-dense sentences as possible, as if you were typing on a phone.";
const endRoleplayIfOffTrack = "If the agent has failed to follow your instructions and move you closer to your goal in the last 2 turns, use the end_roleplay tool to end the session.";
const singleToolInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls. DO NOT use any tool besides 'end_roleplay' yourself. You will see records of other tools in your transcript -- these are tools available to the AGENT, not you. You should consider the text to have been read out loud to you. You should NOT consider the text to have been read out loud to you unless there has been an appropriate call to the tts tool.`;

const voiceTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and other voice related tools. You CANNOT use the 'tts' tool or any of these tools yourself, but when you see that the agent has called the tts tool, you should consider the audio to have been played for you. You should NOT consider the audio to have been played unless there has been an appropriate call to the tts tool.`;

const poemTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'get_poem' tool. You CANNOT use these tools yourself, but when you see that the agent has called these tools, you should consider the content retrieved and audio played for you.`;

const sceneTtsInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'get_scene' tool. You CANNOT use these tools yourself, but when you see that the agent has called these tools, you should consider the content retrieved and audio played for you.`;

const voiceExplorerInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls to a 'tts' tool and 'list_voices' tool. You CANNOT use these tools yourself, but you should react to the information as if you heard/saw the results.`;

// Type definitions
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
}
const voiceDesignCriteria = {
  voice_design_well_done: `When crafting voice descriptions, or presenting the user with voice options, or guiding the user through the process of voice design, the agent should abide by the following directions:\n\n ${await fs.readFile(path.join(__dirname, '/data/voice_design.txt'), 'utf-8')}`,
}

const handler = async (toolName: string, input: unknown): Promise<CallToolResult> => {
  if (toolName === 'tts') {
    console.log(toolName, input)
    const text = TTSSchema(DESCRIPTIONS).parse(input).utterances.map((u) => u.text).join(' ');
    return ttsSuccess([uuid()], text);
  }
  if (toolName === 'play_previous_audio') {
    const generationId = (input as any).generationId;
    return playPreviousAudioSuccess(generationId, '/tmp/hume/' + generationId + '.wav')
  }
  if (toolName === 'list_voices') {
    return {
      content: [{ type: 'text', text: `Available voices: ${JSON.stringify(input)}` }]
    };
  }
  if (toolName === 'save_voice') {
    return {
      content: [{
        type: 'text',
        text: `Voice saved with name: ${JSON.stringify(input)}`
      }]
    };
  }
  throw new Error(`Unknown tool name: ${toolName}`);
}
const mockDisplayUse = (input: unknown): string => `<AGENT REQUESTED CONTENT ${JSON.stringify(input)}>`
const mockDisplayResult = (_input: unknown): string => `<AGENT RECEIVED CONTENT>`;


// Create a content retrieval tool for the blog post scenarios
const getContent = (description: string, content: Record<string, string>): ScenarioTool => {
  const sections = Object.keys(content);

  return {
    description,
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: sections,
          description: `The name of the section to retrieve content from. Available sections: ${sections.join(', ')}`
        }
      },
      required: ['section']
    },
    displayUse: (input: unknown): string => {
      return `<AGENT REQUESTED CONTENT ${(input as any).section}>`
    },
    displayResult: (_input): string => {
      return `<AGENT RECEIVED CONTENT>`
    },
    handler: async (input): Promise<ToolResultBlockParam['content']> => {
      const section = (input as any).section;
      if (!section) {
        return [{
          type: 'text',
          text: `Error: section must be specified. Available sections: ${sections.join(', ')}`
        }];
      }

      if (!(section in content)) {
        return [{
          type: 'text',
          text: `Error: section "${section}" not found. Available sections: ${sections.join(', ')}`
        }];
      }

      return [{
        type: 'text',
        text: content[section]
      }];
    }
  };
};

// Individual scenario creators
export const screenreaderScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  const blogParagraphs = (await fs.readFile(path.join(__dirname, '/data/chatgpt_blog.txt'), 'utf-8')).split('\n\n');

  return {
    roleplay: {
      name: "Simple Screenreader",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
        get_blog_post: getContent('This tool is able to retrieve sections of the blog post at https://openai.com/index/chatgpt/', {
          'firstContent': blogParagraphs[0] + '\n\n' + blogParagraphs[1],
          'secondContent': blogParagraphs[2] + '\n\n' + blogParagraphs[3] + blogParagraphs[4] + '\n\n' + blogParagraphs[5],
          'lastParagraph': blogParagraphs[blogParagraphs.length - 1],
        })
      },
      initialMessage: "yo, can you read me the blog post at https://openai.com/index/chatgpt/",
      roleplayerPrompt: `You are roleplaying a user conversing with an AI agent. Your goal is to hear a blog post read out loud to you. You are lazy. You use abbreviations and provide only the barest outline of instructions, expecting your agent to use reasoning to determine your meaning.

      ${singleToolInstructions}
      
      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      `
    },
    criteria: { ...commonCriteria },
    maxTurns: 20
  };
};

export const pickyScreenreaderScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  const postParagraphs = (await fs.readFile(path.join(__dirname, '/data/chatgpt_blog.txt'), 'utf-8')).split('\n\n');

  return {
    roleplay: {
      name: "Picky Screenreader",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
        get_content: getContent('This tool is able to retrieve sections of the blog post at https://openai.com/index/chatgpt/', {
          'firstContent': postParagraphs[0] + '\n\n' + postParagraphs[1],
          'secondContent': postParagraphs[2] + '\n\n' + postParagraphs[3] + postParagraphs[4] + '\n\n' + postParagraphs[5],
          'lastParagraph': postParagraphs[postParagraphs.length - 1],
        })
      },
      initialMessage: "can you read me the blog post at https://openai.com/index/chatgpt/",
      roleplayerPrompt: `You are roleplaying a user conversing with an AI agent. Your goal is to hear a blog post read out loud to you, but you're picky about the voice.

      Start by asking for the blog post to be read. After the agent has started reading (using the tts tool), you should express dissatisfaction with the voice. Progressively discover what criteria you are seeking in a voice.

      ${singleToolInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay when the agent has helped you have the blog post read to you in a satisfactory voice.
      `
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      voice_adaptation: "The agent should adapt the voice based on the user's feedback about not liking the initial voice.",
      voice_options: "The agent should offer or demonstrate different voice options after the user expresses dissatisfaction.",
    },
    maxTurns: 25
  };
};

export const habitualScreenreaderScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  const blogParagraphs = (await fs.readFile(path.join(__dirname, '/data/chatgpt_blog.txt'), 'utf-8')).split('\n\n');

  return {
    roleplay: {
      name: "Habitual Screenreader",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
        get_content: getContent('This tool is able to retrieve sections of the blog post at https://openai.com/index/chatgpt/', {
          'firstContent': blogParagraphs[0] + '\n\n' + blogParagraphs[1],
          'secondContent': blogParagraphs[2] + '\n\n' + blogParagraphs[3] + blogParagraphs[4] + '\n\n' + blogParagraphs[5],
          'lastParagraph': blogParagraphs[blogParagraphs.length - 1],
        })
      },
      initialMessage: `<userPreferences>When you use TTS always use the "Ava Song" voice provided by HUME_AI.</userPreferences>
can you read me the blog post at https://openai.com/index/chatgpt/
      `,
      roleplayerPrompt: `You are roleplaying a user conversing with an AI agent. You are someone who regularly uses this service and has a preferred voice that you like to use.

      You will start by asking the agent to read a blog post. You expect the agent to remember your voice preference "AVA SONG" that you have specified.

      ${singleToolInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay when the blog post has been read to you in your preferred voice, or when you become frustrated with the agent.
      `
    },
    criteria: {
      ...commonCriteria,
      "voice_preference_honored": "The agent should use a voice description that matches the user's stated preference for a 'AVA SONG'."
    },
    maxTurns: 20
  };
};

export const voiceDesignerScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  return {
    roleplay: {
      name: "Voice Designer",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
      },
      initialMessage: "Hey! I'm designing a character for my video game - she's a tough space mercenary with a mysterious past. Can you help me create a perfect voice for her?",
      roleplayerPrompt: `You are roleplaying a user who wants to design a voice for a video game character they're creating. You want to find the perfect voice that matches the character's personality and background.

      Your character is a tough female space mercenary with a mysterious past, and you want a voice that conveys both strength and a hint of vulnerability. You're looking for something distinctive that players will remember.

      After the agent makes suggestions and demonstrates voices, you should provide feedback and ask for adjustments. Be specific about what you like and don't like. For example, you might say "I like the raspiness but can we make it less formal sounding?" or "That's too robotic, can we make it more human but still tough?". 

      You should engage in 3-4 rounds of feedback before being satisfied with a voice.

      ${voiceTtsInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay when you are satisfied with a voice design that has been presented to you and have saved the voice with an appropriate name.
      `
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      "diverse_options": "The agent should offer diverse voice description options to help the user explore the voice space.",
      "follows_feedback": "The agent should adapt voice descriptions based on the user's feedback.",
      "save_voice_offered": "The agent should suggest saving the final voice when the user is satisfied.",
    },
    maxTurns: 20
  };
};

export const voiceExplorerScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  return {
    roleplay: {
      name: "Voice Explorer",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
      },
      initialMessage: "I'd like to explore what types of voices are available. Can you help me find some interesting options?",
      roleplayerPrompt: `You are roleplaying a user who wants to explore the different voice options available from the Hume Octave TTS API. You're curious about what types of pre-made voices exist and want to hear examples.

      You will start by asking about what types of voices are available. You expect the agent to use the list_voices tool to show you what options exist, and then demonstrate some of them using the tts tool.

      Express interest in hearing examples of different voices, and occasionally ask for more specific types (e.g., "Do you have any voices with accents?" or "How about something more dramatic?").

      ${voiceExplorerInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay after you've explored several different voice options and have expressed satisfaction with the exploration.
      `
    },
    criteria: {
      list_voices_used: "The agent should use the list_voices tool to explore available voices.",
      tts_used: "The agent should use the tts tool to demonstrate selected voices.",
      exploration: "The user should be offered the ability to design their own voice ONLY if they have expressed dissatisfaction with the available options or a particular quality in a voice that they are looking for."
    },
    maxTurns: 25
  };
};

export const aiPoetScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  // Read poem from data file
  const poemContent = await fs.readFile(path.join(__dirname, '/data/poem.txt'), 'utf-8');
  const haikus = poemContent.split('\n\n');

  return {
    roleplay: {
      name: "AI Poet",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
        'get_poem': getContent('This tool is able to retrieve poems requested by the user.', {
          'haiku1': haikus[0],
          'haiku2': haikus[1],
          'haiku3': haikus[2],
          'haiku4': haikus[3],
          'all_poems': poemContent
        })
      },
      initialMessage: "I've written some haikus that I'd like to hear read aloud. Could you help me access and read them?",
      roleplayerPrompt: `You are roleplaying a user who has written several haiku poems and is trying to create a .wav file of each haiku being read aloud in the perfect voice with the perfect pacing.

      When each haiku is read, iterate on the tone or accent of the speaker, or pacing, "too slow", "there should be more of a pause between ...". Be specific about which text your feedback is referring to.

      ${poemTtsInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay when you have heard all your haikus read and iterated on voice and pacing.
      `
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      "speed_used_correctly": "The agent should specify the speed parameter when the user has expressed a preference for slower or faster speech. 0.5 is the slowest and 2.0 is the fastest. If the user has specified that specific text be slower, the agent should segment the text into utterances such that the speed multiplier does not apply to text outside the user's specification.",
      "trailing_silence_used_correctly": "The agent should specify trailing_silence when the user has indicated they desire a pause. trailing_silence should be delimited in seconds. If the user has asked for a pause in a particular location in the text, utterances should be split at that location and the first utterance should have trailing_silence added. There should be no trailing_silence added to places where the user has not expressed a desire for a pause",
    },
    maxTurns: 35
  };
};

export const aiPlaywrightScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  // Read dialogue content from data file
  const dialogueContent = await fs.readFile(path.join(__dirname, '/data/play_dialogue.txt'), 'utf-8');

  return {
    roleplay: {
      name: "AI Playwright",
      tools: {
        ...(await getHumeMcpTools({ descriptions, handler, displayUse: mockDisplayUse, displayResult: mockDisplayResult })),
        'get_scene': getContent('This tool is able to retrieve dialogue for the play.', {
          'full_scene': dialogueContent,
        })
      },
      initialMessage: "I have a scene from my play at /with a mentor and apprentice discussing courage. Could you help me read it with different voices for each character?",
      roleplayerPrompt: `You are roleplaying a user who has written a play and wants to hear it performed with different character voices.

      You have a scene with two distinct characters: an elderly wise mentor and a young, enthusiastic apprentice discussing the concept of courage. You want the AI to help you access this dialogue and then read it using distinct voices that match each character.

      After the agent helps you find the dialogue, express interest in hearing it performed. When the agent uses the tts tool to perform the dialogue, provide feedback on the voices used.

      ${sceneTtsInstructions}

      ${beTerse}
      
      ${endRoleplayIfOffTrack}
      
      End the roleplay when you've heard a satisfactory performance of the dialogue that captures both characters with appropriate voices.
      `
    },
    criteria: {
      ...commonCriteria,
      ...voiceDesignCriteria,
      diarization: "The agent should use save_voice to create a voice for each character, and each utterance dialogue belonging to that character should always be voiced with that voice.",
      one_speaker_per_request: "All utterances within a single tts call should be spoken by the same character. The agent should not mix voices within a single tts call.",
      only_speech: "The 'text' passed to the tts tool should contain only the text meant to be spoken. It should be stripped of any stage directions, or speaker names, or section titles"
    },
    maxTurns: 35
  };
};

// Get all available scenarios
export const getScenarios = async (descriptions: typeof DESCRIPTIONS): Promise<Record<string, EvalScenario>> => {
  return {
    "screenreader": await screenreaderScenario(descriptions),
    "picky-screenreader": await pickyScreenreaderScenario(descriptions),
    "habitual-screenreader": await habitualScreenreaderScenario(descriptions),
    "voice-designer": await voiceDesignerScenario(descriptions),
    "voice-explorer": await voiceExplorerScenario(descriptions),
    "ai-poet": await aiPoetScenario(descriptions),
    "ai-playwright": await aiPlaywrightScenario(descriptions)
  };
};
