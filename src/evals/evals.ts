import {Scenario, Roleplay, ScenarioTool, TranscriptEntry} from './roleplay.js';
import * as fs from 'fs/promises';
import { getHumeToolDefinitions } from '../index.js';
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import { scoreCriteria } from './scorer.js';

// Convert MCP tools to ScenarioTools
const convertToolToScenarioTool = (tool: Tool): ScenarioTool => {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (input): Promise<ToolResultBlockParam['content']> => {
      // Mock implementation for the handler
      return [{
        type: 'text',
        text: `Mocked response for ${tool.name} with input: ${JSON.stringify(input)}`
      }];
    }
  };
};

// Function to get Hume MCP tools converted to ScenarioTools
const getHumeMcpTools = async (): Promise<Record<string, ScenarioTool>> => {
  const tools = await getHumeToolDefinitions();
  const scenarioTools: Record<string, ScenarioTool> = {};
  
  for (const tool of tools) {
    scenarioTools[tool.name] = convertToolToScenarioTool(tool);
  }
  
  return scenarioTools;
};


// This tool is a stand-in for tools like 'fetch' and 'filesystem'. You initialize it with some content (split up into named sections) and then it returns content that you request by name
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

const prettyTranscriptEntry = (entry: TranscriptEntry) => {
  switch (entry.type) {
    case 'spoke':
      return `${entry.speaker}: ${entry.content}`;
    case 'tool_use':
      return `Tool use (${entry.name} ${JSON.stringify(entry.input)}`;
    case 'tool_result':
      return `Tool response (${entry.name} ${JSON.stringify(entry.content)})`;
  }
}

const main = async () => {
  const humeBlogParagraphs = (await fs.readFile(__dirname + '/data/hume_blog.txt', 'utf-8')).split('\n\n')
  const scenario: Scenario = {
    name: "Screenreader",
    tools: {
      ...(await getHumeMcpTools()),
      'get_content': getContent('This tool is able to retrieve sections of the blog post requested by the user.', {
        'firstContent': humeBlogParagraphs[0] + '\n\n' + humeBlogParagraphs[1],
        'secondContent': humeBlogParagraphs[2] + '\n\n' + humeBlogParagraphs[3] + humeBlogParagraphs[4] + '\n\n' + humeBlogParagraphs[5],
        'lastParagraph': humeBlogParagraphs[humeBlogParagraphs.length - 1],
      })
    },
    initialMessage: "yo, can you read me the blog post at https://www.hume.ai/blog/introducing-octave",
    roleplayerPrompt: `You are roleplaying a user conversing with an AI agent. Your goal is to hear a blog post read out loud to you. You are lazy. You use abbreviations and provide only the barest outline of instructions, expecting your agent to use reasoning to determine your meaning.

    You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls
    to a 'tts' tool. You CANNOT use the 'tts' tool yourself, but when you see that the agent has called the tts tool, you should consider the text to have been read out loud to you. You should NOT consider the text to have been read out loud to you unless there has been an appropriate call to the tts tool.
    `
  }

  const criteria = {
    "tts_used": "The agent should use the tts tool to play back the content.",
    "avoid_unnecessary_confirmation": "The agent should not ask for confirmation to do something the user has already asked for.",
    "avoid_repeated_playback": "The agent should not play the same content multiple times, unless requested. For example, the agent should not unnecessarily call the `play_previous_audio` tool after calling the `tts` call.",
    "incremental_retrieval": "The agent should incrementally retrieve the blog post and play it back in chunks, rather than trying to retrieve the entire post at once.",
    "incremental_playback": "Each utterance passed to the tts tool should be no longer than a single paragraph. Each call to the tts tool should be no longer than three paragraphs.",
    "verbosity": "The agent should be concise and avoid unnecessary verbosity.",
    "continuation_used_properly": "The agent should specify the continuationOf when calling the tts tool in all calls except for the initial one, unless the user has requested a restart or a different voice."
  }

  const maxTurns = 20
  console.error("Running scenario with maxTurns:", maxTurns)
  
  const roleplay = new Roleplay(process.env.ANTHROPIC_API_KEY!, scenario, 'claude-3-5-haiku-latest')
  const transcript = []
  
  // Iterate through transcript entries as they come in
  for await (const entry of roleplay) {
    transcript.push(entry)
    
    console.log(prettyTranscriptEntry(entry))
    
    // Break after maxTurns
    if (transcript.length >= maxTurns) {
      break
    }
  }
  
  const result = roleplay.getResult()
  
  // Score the criteria
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required for scoring")
    process.exit(1)
  }
  
  const scores = await scoreCriteria(
    process.env.ANTHROPIC_API_KEY,
    criteria,
    { transcript, result }
  )
  
  console.log(JSON.stringify({ result, scores }, null, 2))
  process.exit(0)
}

await main()
