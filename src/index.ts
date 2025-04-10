import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HumeClient } from "hume";
import { z } from "zod";
import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  PostedContextWithGenerationId,
  PostedTts,
  PostedUtterance,
} from "hume/api/resources/tts";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";


const truncate = (str: string, maxLength: number) => {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + "...";
}

// Global map to store file paths by generationId
export const audioMap = new Map<string, string[]>();

let logFile: fs.FileHandle;

const log = (...args: any[]) => {
  console.error(...args);
  logFile?.write(JSON.stringify(args) + "\n");
}

const hume = new HumeClient({
  apiKey: process.env.HUME_API_KEY!,
});

const ttsArgs = {
  utterances: z.array(
    z.object({
      text: z
        .string()
        .describe("The input text to be synthesized into speech."),
      description: z
        .string()
        .optional()
        .describe(
          `Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, pacing, and accent (e.g., 'a soft, gentle voice with a strong British accent'). If a Voice is specified in the request, this description serves as acting instructions. If no Voice is specified, a new voice is generated based on this description.`,
        ),
    }),
  ),
  voiceName: z
    .string()
    .optional()
    .describe(
      "The name of the voice from the voice library to use as the speaker for the text.",
    ),
  provider: z
    .enum(["HUME_AI", "CUSTOM_VOICE"])
    .optional()
    .describe(
      "Set this only when using `voiceName` to specify a voice provided by Hume.",
    ),
  continuationOf: z
    .string()
    .optional()
    .describe(
      "The generationId of a prior TTS generation to use as context for generating consistent speech style and prosody across multiple requests. If the user is trying to synthesize a long text, you should encourage them to break it up into smaller chunks, and always specify continuationOf for each chunk after the first.",
    ),
  quiet: z
    .boolean()
    .default(false)
    .describe("Whether to skip playing back the generated audio."),
}

export const TTSSchema = z.object(ttsArgs)
export type TTSCall = z.infer<typeof TTSSchema>;

export const ttsSuccess = (generationIds: Array<string>, text: string): CallToolResult => ({
  content: [
    {
      type: "text",
      text: `Created audio for text: "${truncate(text, 50)}", generation ids: ${generationIds
        .map((g) => {
          const filePath = audioMap.get(g);
          return `${g} (file: ${filePath})`;
        })
        .join(", ")}`,
    },
  ],
})

export const setup = (server: McpServer) => {
  // Register TTS tool with expanded options
  server.tool(
    "tts",
    `Synthesizes speech from text.

This tool is useful for
a) Character design:
  To design a character, first read the prompting guide at https://dev.hume.ai/docs/text-to-speech-tts/prompting if you can. Then, prompt the user to specify what qualities they desire in the character's voice, such as gender, accent, pitch, role/context, emotionality. Then, write a highly stylized sample text (e.g. use dialect if there's an accent, use CAPITAL LETTERS for emphasis if there's emotion, use ellipses if there's pausing.) along with a voice description. Use these with the 'tts' tool to generate several variants. Play the audio with the 'play_audio' tool and ask the user what they think. If they like them, use the 'save_voice' tool to give the voice a name.

b) Generating speech:
  If the user has text and has already created a voice, or has a generation to continue from, or desires to have text spoken with a novel voice, use the 'tts' tool to create audio files from the speech. For longer texts, typically break them up into shorter segments, and use continuation to tackle them piece by piece. If they like it (and if you have filesystem access) you should save the audio segment (copy it over from the temporary directory) into a more permanent location specified by the user.
  `,
    ttsArgs,
    async ({ continuationOf, voiceName, quiet, utterances: utterancesInput }) => {
      // Create the utterance with voice if specified
      const utterances: Array<PostedUtterance> = [];
      for (const utt of utterancesInput) {
        let utterance: PostedUtterance = {
          text: utt.text,
          description: utt.description ? utt.description : undefined,
        };
        if (voiceName) {
          utterance = {
            ...utterance,
            voice: {
              name: voiceName,
            },
          };
        }
        utterances.push(utterance);
      }

      const context: PostedContextWithGenerationId | null = continuationOf
        ? { generationId: continuationOf }
        : null;

      // Prepare the utterance with optional parameters
      const request: PostedTts = {
        utterances,
        ...(context ? { context } : {}), // conditionally add context
      };

      const text = utterances.map((u) => u.text).join(" ");
      log(
        `Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
      );
      const createdAt = Date.now();

      try {
        // Create temporary directory for audio files
        const tempDir = path.join(os.tmpdir(), "hume-tts");

        // Ensure directory exists
        await fs.mkdir(tempDir, { recursive: true });

        const generationIds = new Set<string>();

        let playback = Promise.resolve();

        const chunks = [];
        for await (const audioChunk of await hume.tts.synthesizeJsonStreaming(
          request,
        )) {
          log(`Received audio chunk: ${JSON.stringify(audioChunk, (k, v) => {
            if (k === "audio") {
              return "[Audio Data]";
            }
          })}`);
          chunks.push(audioChunk);
          const generationIndex =
            chunks.filter(
              (chunk) => chunk.generationId === audioChunk.generationId,
            ).length - 1;
          const { audio, generationId } = audioChunk;

          generationIds.add(generationId);

          const audioData = Buffer.from(audio, "base64");

          // Create a temporary file to store the audio
          const fileName = `${generationId}-chunk-${generationIndex}.wav`;
          const tempFilePath = path.join(tempDir, fileName);

          // Write audio to file
          await fs.writeFile(tempFilePath, audioData);

          if (!quiet) {
            playback = playback.then(() => playAudio(tempFilePath));
          }

          // Store the file path
          const generationChunks = audioMap.get(generationId);
          generationChunks
            ? generationChunks?.push(tempFilePath)
            : audioMap.set(generationId, [tempFilePath]);

          log(
            `Stored audio chunk for generationId: ${generationId}, file: ${tempFilePath}, created at ${createdAt}`,
          );
        }
        await playback;
        return ttsSuccess([...generationIds], text);
      } catch (error) {
        log(
          `Error synthesizing speech: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Error synthesizing speech: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.tool(
    "play_previous_audio",
    "Plays back audio by generationId using ffplay.",
    {
      generationId: z.string().describe("The generationId of the audio to play"),
    },
    async ({ generationId }) => {
      const filePaths = audioMap.get(generationId);

      if (!filePaths) {
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
      const filePath = filePaths[0];
      try {
        await fs.access(filePath);
      } catch (error) {
        log(`File not found: ${filePath}`);
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

      log(`Executing command: ${command}`);

      const ret: { type: "text"; text: string }[] = [];
      try {
        for (const filePath in filePaths) {
          await playAudio(filePath);
          ret.push({
            type: "text",
            text: `Played audio for generationId: ${generationId}, file: ${filePath}`,
          });
        }
        return { content: ret };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: (e as Error).message,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "list_voices",
    "Lists available voices.",
    {
      provider: z
        .enum(["HUME_AI", "CUSTOM_VOICE"])
        .default("CUSTOM_VOICE")
        .describe(
          "Set this to HUME_AI to see the preset voices provided by Hume, instead of the custom voices in your account.",
        ),
      pageNumber: z
        .number()
        .optional()
        .default(0)
        .describe("The page number to retrieve."),
      pageSize: z
        .number()
        .optional()
        .default(100)
        .describe("The number of voices to retrieve per page."),
    },
    async ({ provider, pageNumber, pageSize }) => {
      try {
        log(`Listing voices for provider: ${provider}`);
        const voices = await hume.tts.voices.list({
          provider,
          pageNumber,
          pageSize,
        });
        log(`Voices: ${JSON.stringify(voices, null, 2)}`);
        return {
          content: [
            {
              type: "text",
              text: `Available voices:\n${voices.data.map((voice) => `${voice.name} (${voice.id})`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        log(
          `Error listing voices: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Error listing voices: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "delete_voice",
    "Deletes a custom voice from your account's voice library",
    {
      name: z.string().describe("The name of the voice to delete."),
    },
    async ({ name }) => {
      try {
        log(`Deleting voice with name: ${name}`);
        const response = await hume.tts.voices.delete({
          name,
        });
        return {
          content: [
            {
              type: "text",
              text: `Successfully deleted voice "${name}".`,
            },
          ],
        };
      } catch (error) {
        log(
          `Error deleting voice: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Error deleting voice: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Add save_voice tool to save a voice to the Voice Library
  server.tool(
    "save_voice",
    "Saves a generated voice to your Voice Library for reuse in future TTS requests.",
    {
      generationId: z
        .string()
        .describe(
          "The generationId of the voice to save, obtained from a previous TTS request.",
        ),
      name: z
        .string()
        .describe(
          "The name to assign to the saved voice. This name can be used in voiceName parameter in future TTS requests.",
        ),
    },
    async ({ generationId, name }) => {
      try {
        log(
          `Saving voice with generationId: ${generationId} as name: "${name}"`,
        );

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
        log(
          `Error saving voice: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Error saving voice: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

const playAudio = async (filePath: string) => {
  const command = `ffplay -autoexit -nodisp "${filePath}"`;
  await new Promise<void>((resolve, reject) => {
    exec(command, (error, _stdout, stderr) => {
      if (stderr) {
        log(`ffplay stderr: ${stderr}`);
      }
      if (error) {
        log(`Error playing audio: ${error.message}`);
        return reject(error.message);
      }
      resolve();
    });
  });
};

const main = async () => {
  // Create server instance for the main app
  const server = createHumeServer();

  logFile = await fs.open('/tmp/mcp-server-hume.log', 'a');
  if (!process.env.HUME_API_KEY) {
    log("Please set the HUME_API_KEY environment variable.");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Hume MCP Server running on stdio");
}

process.on('exit', async () => {
  await logFile.close();
})


// Export function to create and configure the server
export const createHumeServer = () => {
  // Create server instance
  const server = new McpServer({
    name: "hume",
    version: "1.0.0",
  });

  // Configure all tools
  setup(server);

  return server;
}

// Export function to get tool definitions without creating a full server
export const getHumeToolDefinitions = async () => {
  // Create a temporary server to extract tool definitions
  const server = new McpServer({
    name: "hume-tools",
    version: "1.0.0",
  });

  setup(server);

  return (await (server.server as any)._requestHandlers.get("tools/list")({ method: "tools/list" })).tools as Array<Tool>
}

main().catch((error) => {
  log("Fatal error in main():", error);
  process.exit(1);
});
