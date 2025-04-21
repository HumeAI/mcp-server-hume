import * as fs from 'fs/promises';
import * as path from 'path';
import { DESCRIPTIONS } from '../../index.js';
import { getHumeMcpTools } from '../utils.js';
import { EvalScenario, commonCriteria, commonInstructions, voiceDesignCriteria } from './types.js';
import { getContent, handler, mockDisplayResult, mockDisplayUse } from './helpers.js';

export const pickyScreenreaderScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  const postParagraphs = (await fs.readFile(path.join(__dirname, '/../data/chatgpt_blog.txt'), 'utf-8')).split('\n\n');

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

      ${commonInstructions}
      
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