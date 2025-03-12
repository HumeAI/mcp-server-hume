import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HumeClient } from "hume"
import { unknown, z } from "zod";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PostedContextWithGenerationId, PostedTts, PostedUtterance } from 'hume/api/resources/tts';

// Global map to store audio data by generationId
export const audioMap = new Map<string, Uint8Array>();

// Create server instance
const server = new McpServer({
  name: "hume",
  version: "1.0.0",
});

const hume = new HumeClient({ 
  apiKey: process.env.HUME_API_KEY!
})

// Register TTS tool with expanded options
server.tool(
  "tts",
  "Synthesizes speech from text.",
  {
    text: z.string().describe("The text to synthesize into speech."),
    description: z.string().optional().describe("Optional description of the speech context or emotion."),
    continuationOf: z.string().optional().describe("Optional generationId to continue speech from a previous generation."),
  },
  async ({ text, description, continuationOf }) => {
    const utterance: PostedUtterance = description ? { text, description } : { text };
    const context: PostedContextWithGenerationId | null = continuationOf ? { generationId: continuationOf } : null;
  
    // Prepare the utterance with optional parameters
    const request: PostedTts = {
      utterances: [ utterance ],
      ...(context ? { context } : {}), // conditionally add context
    }
    
    console.error(`Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    
    const response = await hume.tts.synthesizeJson(request);
    const generation = response.generations[0];
    const { generationId } = generation;

    if (!generationId) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to generate speech",
          },
        ],
      };
    }

    // Extract audio data from the response and store in the global map
    try {
      // Get the audio data as a buffer
      const audioData = Buffer.from(generation.audio, 'base64');
      
      // Store the audio data in the global map using generationId as the key
      audioMap.set(generationId, audioData);
      
      console.error(`Stored audio for generationId: ${generationId}`);
    } catch (error) {
      console.error('Error extracting audio data:', error);
    }

    return {
      content: [
        {
          type: "text",
          text: generationId,
        },
      ],
    };
  },
);

// Add the playback tool
server.tool(
  "play_audio",
  "Plays back audio by generationId using ffplay.",
  {
    generationId: z.string().describe("The generationId of the audio to play"),
  },
  async ({ generationId }) => {
    const audio = audioMap.get(generationId);
    
    if (!audio) {
      return {
        content: [
          {
            type: "text",
            text: `No audio found for generationId: ${generationId}`,
          },
        ],
      };
    }

    try {
      // Create a temporary file to store the audio
      const tempDir = os.tmpdir();
      const tempFilePath = path.join(tempDir, `${generationId}.wav`);
      
      // Write the audio data to the temporary file
      fs.writeFileSync(tempFilePath, audio);
      
      // Play the audio using ffplay
      const command = `ffplay -autoexit -nodisp "${tempFilePath}"`;
      
      console.error(`Executing command: ${command}`);
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error playing audio: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`ffplay stderr: ${stderr}`);
        }
        
        // Clean up the temporary file after playing
        try {
          fs.unlinkSync(tempFilePath);
          console.error(`Removed temporary file: ${tempFilePath}`);
        } catch (unlinkError) {
          console.error(`Error removing temporary file: ${(unlinkError as any).message}`);
        }
      });

      return {
        content: [
          {
            type: "text",
            text: `Playing audio for generationId: ${generationId}`,
          },
        ],
      };
    } catch (error) {
      console.error(`Error in play_audio tool: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [
          {
            type: "text",
            text: `Error playing audio: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Function to get audio data from the map
export function getAudioData(generationId: string): Uint8Array | undefined {
  return audioMap.get(generationId);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hume MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});