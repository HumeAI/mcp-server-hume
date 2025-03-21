import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HumeClient } from "hume"
import { z } from "zod";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { PostedContextWithGenerationId, PostedTts, PostedUtterance } from 'hume/api/resources/tts';

// Global map to store file paths by generationId
export const audioMap = new Map<string, string>();

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
  `Synthesizes speech from text.

This tool is useful for
a) Character design:
  To design a character, first read the prompting guide at https://dev.hume.ai/docs/text-to-speech-tts/prompting if you can. Then, prompt the user to specify what qualities they desire in the character's voice, such as gender, accent, pitch, role/context, emotionality. Then, write a highly stylized sample text (e.g. use dialect if there's an accent, use CAPITAL LETTERS for emphasis if there's emotion, use ellipses if there's pausing.) along with a voice description. Use these with the 'tts' tool to generate several variants. Play the audio with the 'play_audio' tool and ask the user what they think. If they like them, use the 'save_voice' tool to give the voice a name.

b) Generating speech:
  If the user has text and has already created a voice, or has a generation to continue from, or desires to have text spoken with a novel voice, use the 'tts' tool to create audio files from the speech. For longer texts, typically break them up into shorter segments, and use continuation to tackle them piece by piece. Usually, you should 'play_audio' to present the user with the results. If they like it (and if you have filesystem access) you should save the audio segment (copy it over from the temporary directory) into a more permanent location specified by the user.
  `,
  {
    text: z.string().describe("The input text to be synthesized into speech."),
    description: z.string().optional().describe(`Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, pacing, and accent (e.g., 'a soft, gentle voice with a strong British accent'). If a Voice is specified in the request, this description serves as acting instructions. If no Voice is specified, a new voice is generated based on this description.`),
    continuationOf: z.string().optional().describe("The generationId of a prior TTS generation to use as context for generating consistent speech style and prosody across multiple requests. If the user is trying to synthesize a long text, you should encourage them to break it up into smaller chunks, and always specify continuationOf for each chunk after the first."),
    numGenerations: z.number().optional().default(1).describe("Number of variants to synthesize."),
    voiceName: z.string().optional().describe("The name of the voice from the voice library to use as the speaker for the text."),
  },
  async ({ text, description, continuationOf, voiceName, numGenerations }) => {
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
      numGenerations,
    }

    console.error(`Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    const createdAt = Date.now()

    try {
      const response = await hume.tts.synthesizeJson(request)
      // Create temporary directory for audio files
      const tempDir = path.join(os.tmpdir(), 'hume-tts');
      
      // Ensure directory exists
      await fs.mkdir(tempDir, { recursive: true });
      
      for (const generation of response.generations) {
        const { generationId } = generation;
        const audioData = Buffer.from(generation.audio, 'base64');
        
        // Create a temporary file to store the audio
        const tempFilePath = path.join(tempDir, `${generationId}.wav`);
        
        // Write audio to file
        await fs.writeFile(tempFilePath, audioData);
        
        // Store the file path
        audioMap.set(generationId, tempFilePath);
        
        console.error(`Stored audio for generationId: ${generationId}, file: ${tempFilePath}, created at ${createdAt}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Created audio for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}", generation ids: ${response.generations.map(g => {
              const filePath = audioMap.get(g.generationId);
              return `${g.generationId} (file: ${filePath})`;
            }).join(", ")}`,
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
    const filePath = audioMap.get(generationId);

    if (!filePath) {
      return {
        content: [
          {
            type: "text",
            text: `No audio found for generationId: ${generationId}`,
          },
        ],
      };
    }
    
    // Check if the file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error(`File not found: ${filePath}`);
      return {
        content: [
          {
            type: "text",
            text: `Audio file for generationId: ${generationId} was not found at ${filePath}`,
          },
        ],
      };
    }

    // Play the audio using ffplay
    const command = `ffplay -autoexit -nodisp "${filePath}"`;

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
              text: `Playing audio for generationId: ${generationId}, file: ${filePath}`,
            },
          ],
        });

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

// Function to get audio file path from the map
export function getAudioFilePath(generationId: string): string | undefined {
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
