import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuid } from 'uuid';
import { DESCRIPTIONS, TTSSchema, playPreviousAudioSuccess, ttsSuccess } from '../../index.js';
import { ScenarioTool } from '../roleplay.js';

// Common utility functions
export const handler = async (toolName: string, input: unknown): Promise<CallToolResult> => {
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
};

export const mockDisplayUse = (input: unknown): string => `<AGENT REQUESTED CONTENT ${JSON.stringify(input)}>`;
export const mockDisplayResult = (_input: unknown): string => `<AGENT RECEIVED CONTENT>`;

// Create a content retrieval tool for the scenarios
export const getContent = (description: string, content: Record<string, string>): ScenarioTool => {
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