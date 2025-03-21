import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HumeClient } from "hume"
import { z } from "zod";
import { exec } from "child_process";
import * as fs from "fs/promises";
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
    numGenerations: z.number().optional().default(1).describe("Number of variants to synthesize."),
    voiceName: z.string().optional().describe("Optional name of the voice to use for synthesis."),
  },
  async ({ text, description, continuationOf, voiceName }) => {
    // Create the utterance with voice if specified
    let utterance: PostedUtterance = description ? { text, description } : { text };
    if (voiceName) {
      utterance = {
        ...utterance,
        voice: {
          name: voiceName,
        }
      };
    }
    
    const context: PostedContextWithGenerationId | null = continuationOf ? { generationId: continuationOf } : null;

    // Prepare the utterance with optional parameters
    const request: PostedTts = {
      utterances: [utterance],
      ...(context ? { context } : {}), // conditionally add context
    }

    console.error(`Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    const createdAt = Date.now()

    try {
      const response = await hume.tts.synthesizeJson(request)
      for (const generation of response.generations) {
        const { generationId } = generation;
        const audioData = Buffer.from(generation.audio, 'base64');
        audioMap.set(generationId, audioData);
        console.error(`Stored audio for generationId: ${generationId}, created at ${createdAt}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Created audio for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}", generation ids: ${response.generations.map(g => g.generationId).join(", ")}`,
          },
        ],
      }
    }
    catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error synthesizing speech: ${error instanceof Error ? error.message : String(error)}`,
          }
        ]
      }
    }
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

    // Create a temporary file to store the audio
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `${generationId}.wav`);

    try {
      await fs.writeFile(tempFilePath, audio);
    } catch (error) {
      console.error(`Error writing audio for play_audio tool: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [
          {
            type: "text",
            text: `Error playing audio: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }

    // Play the audio using ffplay
    const command = `ffplay -autoexit -nodisp "${tempFilePath}"`;

    console.error(`Executing command: ${command}`);

    return await new Promise((resolve) => {
      exec(command, (error, _stdout, stderr) => {
        if (stderr) {
          console.error(`ffplay stderr: ${stderr}`);
        }
        if (error) {
          console.error(`Error playing audio: ${error.message}`);
          return resolve({
            content: [
              {
                type: "text",
                text: `Error playing audio: ${error.message}`,
              },
            ],
            isError: true
          });
        }
        resolve({
          content: [
            {
              type: "text",
              text: `Playing audio for generationId: ${generationId}`,
            },
          ],
        });

        // Clean up the temporary file after playing
        fs.unlink(tempFilePath).then(() => {
          console.error(`Removed temporary file: ${tempFilePath}`);
        }).catch((unlinkError) => {
          console.error(`Error removing temporary file: ${(unlinkError as any).message}`);
        })
      });
    })
  },
);

// Add save_voice tool to save a voice to the Voice Library
server.tool(
  "save_voice",
  "Saves a generated voice to your Voice Library for reuse in future TTS requests.",
  {
    generationId: z.string().describe("The generationId of the voice to save, obtained from a previous TTS request."),
    name: z.string().describe("The name to assign to the saved voice. This name can be used in voiceName parameter in future TTS requests."),
  },
  async ({ generationId, name }) => {
    try {
      console.error(`Saving voice with generationId: ${generationId} as name: "${name}"`);
      
      // Call the Hume API to save the voice
      const response = await hume.tts.voices.create({
        generationId,
        name,
      });

      return {
        content: [
          {
            type: "text",
            text: `Successfully saved voice "${name}" with ID: ${response.id}. You can use this name in future TTS requests with the voiceName parameter.`,
          },
        ],
      };
    } catch (error) {
      console.error(`Error saving voice: ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: [
          {
            type: "text",
            text: `Error saving voice: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true
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
