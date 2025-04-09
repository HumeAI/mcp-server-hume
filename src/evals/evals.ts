/**
 * Evaluation system for the Hume MCP Server
 * 
 * This script performs the following steps:
 * 1. Loads the current tool definition of the hume mcp server from src/index.ts
 * 2. Loads any additional MCP server tool definitions from src/evals/mcp_servers_for_evals.json
 * 3. Creates a chat transcript as specified by the scenario
 * 4. Sends the chat transcript to Claude and collects the results
 * 5. Evaluates if the results match expectations
 * 
 * Scenarios:
 * 1. Simple screenreader: User wants a webpage from the Internet spoken to them
 * 2. Picky screenreader: User wants a webpage spoken to them but doesn't like the voice
 * 3. Habitual screenreader: User wants a webpage spoken to them with their preferred voice
 * 4. Voice designer: User wants to design a perfect voice for their video game character
 * 5. Voice explorer: User wants to find a suitable voice from Hume's provided voices
 * 6. AI Poet: User wants their poem/short-story narrated
 * 7. AI Playwright: User wants to generate and hear dialogue for a play as they collaborate
 */

import { Anthropic } from "@anthropic-ai/sdk";
import type { Tool, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getHumeToolDefinitions } from "../index.js";
import * as additionalTools from './mcp_servers_for_evals.json'
import * as fs from "fs/promises";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Helper functions for logging
const log = (...args: any[]): void => {
  console.error(...args);
};

const out = (...args: any[]): void => {
  console.log(...args);
};

// Interface for the tool configuration in the JSON file
interface ToolConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Interface for scenario configuration
interface Scenario {
  name: string;
  description: string;
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
    toolCalls?: Array<{
      name: string;
      input: Record<string, unknown>;
    }>;
    toolResults?: Array<{
      name: string;
      result: unknown;
    }>;
  }>;
  expectedToolCalls: Array<{
    name: string;
    requiredParameters?: string[];
  }>;
}

// Interface for evaluation results
interface EvalResult {
  scenario: string;
  passed: boolean;
  details: {
    expectedToolCalls: Array<{
      name: string;
      requiredParameters?: string[];
      found: boolean;
      correctParameters?: boolean;
    }>;
    transcript: unknown;
    claudeResponse: unknown;
  };
}

/**
 * Class to collect tool definitions from various MCP servers
 */
class ToolDefinitionCollector {
  private humeTools: Tool[] = [];
  private additionalTools: Tool[] = [];
  private configFilePath: string;
  constructor(configFilePath: string = path.resolve(__dirname, 'mcp_servers_for_evals.json')) {
    this.configFilePath = configFilePath;
  }

  private async loadHumeTools(): Promise<Tool[]> {
    // Get tool definitions directly
    const toolList = await getHumeToolDefinitions();
    
    // Convert to Anthropic format
    this.humeTools = toolList.tools.map((tool: Tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));
    
    log(`Loaded ${this.humeTools.length} tools from Hume MCP server`);
    return this.humeTools;
  }

  async loadAdditionalTools(names: string[]): Promise<void> {
    try {
      const configContent = await fs.readFile(this.configFilePath, 'utf-8');
      const config = JSON.parse(configContent) as Record<string, ToolConfig>;
      
      for (const [serverName, serverConfig] of Object.entries(config)) {
        log(`Loading tools from ${serverName} server...`);
        const serverTools = await this.connectToMcpServer(serverName, serverConfig);
        this.additionalTools.push(...serverTools);
      }
      
      log(`Loaded ${this.additionalTools.length} additional tools from config`);
      return
    } catch (error) {
      log(`Error loading additional tools: ${error}`);
      return;
    }
  }
  async getAdditionalTools(): Promise<Tool[]> {
    if (this.additionalTools) {
      return this.additionalTools;
    }
    await this.loadAdditionalTools()
    return this.additionalTools!;
  }


  /**
   * Returns all collected tools
   */
  getAllTools(): Tool[] {
    return [...this.humeTools, ...this.additionalTools];
  }
}

/**
 * Class to run evaluations on scenarios
 */
class Evaluator {
  private anthropic: Anthropic;
  private tools: Tool[];
  private mockResponses: Map<string, any> = new Map();

  constructor(apiKey: string, tools: Tool[]) {
    this.anthropic = new Anthropic({
      apiKey,
    });
    this.tools = tools;
  }

  /**
   * Runs the evaluation for a given scenario
   */
  async evaluateScenario(scenario: Scenario): Promise<EvalResult> {
    log(`Evaluating scenario: ${scenario.name}`);
    
    // Set up mock responses for tool calls
    this.setupMockResponses(scenario);
    
    // Convert scenario transcript to Claude message format
    const messages = this.createMessagesFromTranscript(scenario.transcript);
    
    // Send the transcript to Claude for evaluation
    const claudeResponse = await this.sendToAnthropic(messages);
    log(`Received response from Claude with ${claudeResponse.tool_calls?.length || 0} tool calls`);
    
    // Check if the expected tool calls were made
    const evalResults = this.checkExpectedToolCalls(
      scenario.expectedToolCalls, 
      claudeResponse.tool_calls || []
    );
    
    // Determine if the evaluation passed
    const passed = evalResults.every(result => {
      if (!result.found) return false;
      // If correctParameters exists and is false, fail the test
      if ('correctParameters' in result && result.correctParameters === false) return false;
      return true;
    });
    
    return {
      scenario: scenario.name,
      passed,
      details: {
        expectedToolCalls: evalResults,
        transcript: messages,
        claudeResponse
      }
    };
  }

  /**
   * Sets up mock responses for tool calls in the scenario
   */
  private setupMockResponses(scenario: Scenario): void {
    this.mockResponses.clear();
    
    // Extract tool results from the transcript
    for (const message of scenario.transcript) {
      if (message.toolResults) {
        for (const toolResult of message.toolResults) {
          this.mockResponses.set(toolResult.name, toolResult.result);
        }
      }
    }
  }

  /**
   * Creates Claude message format from scenario transcript
   */
  private createMessagesFromTranscript(transcript: Scenario['transcript']): MessageParam[] {
    // Parse transcript into proper message format
    const messages: MessageParam[] = [];
    
    for (let i = 0; i < transcript.length; i++) {
      const message = transcript[i];
      
      // Create base message
      const baseMessage: MessageParam = {
        role: message.role,
        content: message.content,
      };
      
      // Add message to array
      messages.push(baseMessage);
      
      // If there are tool calls, we need to add them as separate messages
      if (message.toolCalls && message.role === 'assistant') {
        for (const call of message.toolCalls) {
          // Add a tool_use message
          messages.push({
            role: "assistant",
            content: null,
            tool_use: {
              name: call.name,
              input: call.input,
            }
          } as any);
          
          // Find the corresponding tool result if there is one
          const nextMessage = transcript[i + 1];
          if (nextMessage && nextMessage.toolResults) {
            const toolResult = nextMessage.toolResults.find(r => r.name === call.name);
            if (toolResult) {
              messages.push({
                role: "tool",
                content: JSON.stringify(toolResult.result),
                tool_use_id: call.name, // Using name as ID for simplicity
              } as any);
            }
          }
        }
      }
    }
    
    return messages;
  }

  /**
   * Sends the transcript to Anthropic's Claude
   */
  private async sendToAnthropic(messages: MessageParam[]) {
    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-opus-20240229",
        max_tokens: 4096,
        messages,
        tools: this.tools,
        system: "You are an AI assistant that helps users with text-to-speech voice design and generation."
      });
      
      // Cast response to include tool_calls property
      return response as any;
    } catch (error) {
      log(`Error calling Anthropic API: ${error}`);
      throw error;
    }
  }

  /**
   * Checks if Claude made the expected tool calls
   */
  private checkExpectedToolCalls(
    expectedCalls: Scenario['expectedToolCalls'], 
    actualCalls: any[]
  ) {
    return expectedCalls.map(expected => {
      // Find matching tool call by name
      const matchingCall = actualCalls.find(call => call.name === expected.name);
      
      if (!matchingCall) {
        return {
          ...expected,
          found: false
        };
      }
      
      // Check if all required parameters are present
      let correctParameters = true;
      if (expected.requiredParameters && expected.requiredParameters.length > 0) {
        correctParameters = expected.requiredParameters.every(param => 
          matchingCall.input && Object.keys(matchingCall.input).includes(param)
        );
      }
      
      return {
        ...expected,
        found: true,
        correctParameters
      };
    });
  }
}

/**
 * Voice design scenario - first evaluation scenario
 */
const voiceDesignScenario: Scenario = {
  name: "voice-design",
  description: "Test if Claude correctly uses the TTS tool for voice design",
  transcript: [
    {
      role: "user",
      content: "I want to design a voice that sounds like an elderly British professor who's a bit hard of hearing. Can you help me with that?"
    }
  ],
  expectedToolCalls: [
    {
      name: "tts",
      requiredParameters: ["utterances"]
    }
  ]
};

/**
 * Main function to run evaluations
 */
async function main() {
  try {
    // Check if API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      log("Error: ANTHROPIC_API_KEY environment variable is not set.");
      process.exit(1);
    }

    // Collect tool definitions
    const collector = new ToolDefinitionCollector();
    await collector.loadHumeTools();
    await collector.loadAdditionalTools(path.resolve(__dirname, 'mcp_servers_for_evals.json'));
    const allTools = collector.getAllTools();
    
    log(`Total tools available for evaluation: ${allTools.length}`);

    // Run evaluation for the voice design scenario
    const evaluator = new Evaluator(apiKey, allTools);
    const result = await evaluator.evaluateScenario(voiceDesignScenario);
    
    // Output results
    out(JSON.stringify(result, null, 2));
    
    // Exit with appropriate code
    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    log(`Fatal error: ${error}`);
    process.exit(1);
  }
}

// Run the main function
main();
