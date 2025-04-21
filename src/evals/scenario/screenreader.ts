import * as fs from 'fs/promises';
import * as path from 'path';
import { DESCRIPTIONS } from '../../index.js';
import { getHumeMcpTools } from '../utils.js';
import { EvalScenario, commonCriteria, singleToolInstructions, beTerse, endRoleplayIfOffTrack } from './types.js';
import { getContent, handler, mockDisplayResult, mockDisplayUse } from './helpers.js';

export const screenreaderScenario = async (descriptions: typeof DESCRIPTIONS): Promise<EvalScenario> => {
  const blogParagraphs = (await fs.readFile(path.join(__dirname, '/../data/chatgpt_blog.txt'), 'utf-8')).split('\n\n');

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