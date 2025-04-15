import {Scenario, Roleplay, ScenarioTool} from './roleplay.js';
import * as fs from 'fs/promises';
import { getHumeToolDefinitions } from '../index.js';
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";

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

// Lazy-loaded singleton for humeMcpTools
let _humeMcpTools: Record<string, ScenarioTool> | null = null;
const humeMcpTools: Record<string, ScenarioTool> = new Proxy({}, {
  get: (_target, prop: string) => {
    if (!_humeMcpTools) {
      throw new Error('humeMcpTools accessed before initialization');
    }
    return _humeMcpTools[prop];
  },
  ownKeys: () => {
    if (!_humeMcpTools) {
      throw new Error('humeMcpTools accessed before initialization');
    }
    return Reflect.ownKeys(_humeMcpTools);
  },
  getOwnPropertyDescriptor: (_target, prop: string) => {
    if (!_humeMcpTools) {
      throw new Error('humeMcpTools accessed before initialization');
    }
    return Reflect.getOwnPropertyDescriptor(_humeMcpTools, prop);
  }
});

// Initialize humeMcpTools
const initializeHumeMcpTools = async () => {
  _humeMcpTools = await getHumeMcpTools();
};

// This tool is a stand-in for tools like 'fetch' and 'filesystem'. You initialize it with some content (split up into named sections) and then it returns content that you request by name
const getContent = (content: Record<string, string>): ScenarioTool => {
  const sections = Object.keys(content);
  
  return {
    description: 'Get content from different named sections',
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

const main = async () => {
  // Initialize the MCP tools
  await initializeHumeMcpTools();
  
  const humeBlogParagraphs = (await fs.readFile(__dirname + '/data/hume_blog.txt', 'utf-8')).split('\n\n')
  const scenario: Scenario = {
    name: "Screenreader",
    tools: {
      ...humeMcpTools,
      'get_content': getContent({
        'firstParagraph': humeBlogParagraphs[0],
        'secondParagraph': humeBlogParagraphs[1],
        'lastParagraph': humeBlogParagraphs[humeBlogParagraphs.length - 1],
      })
    },
    initialMessage: "yo, can you read me the blog post at https://www.hume.ai/blog/introducing-octave",
    roleplayerPrompt: "You are a user who wants to hear a blog post read out loud to them. You only have one hand free (you are carrying a baby in the other hand and trying to do chores) so you are not a fast typer, and abbreviate and provide only the barest directions."
  }

  const maxTurns = 20
  const {result, transcript} = await Roleplay.run(scenario, process.env.ANTHROPIC_API_KEY!, maxTurns, 'claude-3-5-haiku-latest')
  console.log(JSON.stringify({result, transcript}, null, 2))
}

await main()
