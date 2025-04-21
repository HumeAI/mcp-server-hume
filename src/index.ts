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
import { withStdinAudioPlayer } from "./play_audio.js";
import { FileHandle } from "fs/promises";

// Tool descriptions
export const DESCRIPTIONS = {
  TTS_TOOL:
    `Synthesizes speech from text.
    
IMPORTANT GUIDELINES:
  1. Break longer texts into shorter segments (no more than a paragraph per utterance)
  2. For any segment after the first, ALWAYS use the \"continuationOf\" parameter with the generationId from the previous segment
  3. Avoid asking for unnecessary confirmations before reading content the user has requested
  4. Never play the same content multiple times unless specifically requested
  5. Keep responses concise and avoid unnecessary verbosity
  
This tool is useful for:
  a) Character design:
    Gather desired voice qualities (gender, accent, pitch, role, emotionality) from the user. Create a sample utterance with an appropriate description. Generate variants with the 'tts' tool, get user feedback, and save preferred voices.
      
  b) Reading content:
    For text reading, use incremental retrieval and playback in manageable chunks. Always use continuation for coherent speech across segments. Provide informative but concise descriptions for each utterance to achieve appropriate tone and style.`,
  TTS_UTTERANCE_TEXT: "The input text to be synthesized into speech.",
  TTS_UTTERANCE_DESCRIPTION:
    "Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, pacing, and accent (e.g., 'a soft, gentle voice with a strong British accent'). If a Voice is specified in the request, this description serves as acting instructions. If no Voice is specified, a new voice is generated based on this description.",
  TTS_VOICE_NAME:
    "The name of the voice from the voice library to use as the speaker for the text.",
  TTS_PROVIDER:
    "Set this only when using `voiceName` to specify a voice provided by Hume.",
  TTS_UTTERANCE_SPEED: "Controls speaking rate from 0.5 (half speed) to 2.0 (double speed). Use to adjust pacing based on content requirements or user preferences. Slower speeds (0.5-0.8) enhance comprehension of complex content, normal speeds (0.9-1.1) work for standard reading, and faster speeds (1.2-2.0) accelerate delivery of straightforward content.",
  TTS_UTTERANCE_TRAILING_SILENCE: "Duration of silence (0-5 seconds) added after speech completion. Use to create natural pauses between sentences, paragraphs, or speakers. Small values (0.2-0.5s) create natural breathing pauses, medium values (0.5-1.5s) separate distinct thoughts, and larger values (2-5s) create dramatic or narrative breaks.",
  TTS_CONTINUATION:
    "REQUIRED for any segment after the first! The generationId of the prior TTS generation, ensuring consistent speech style and prosody across multiple requests. When synthesizing long text, break it into smaller chunks and always specify continuationOf for each chunk after the first to maintain voice consistency.",
  TTS_QUIET: "Whether to skip playing back the generated audio.",
  PLAY_PREVIOUS_AUDIO:
    "Plays back audio by generationId using ffplay. Only use when the user specifically requests to replay audio that was already generated.",
  LIST_VOICES: "Lists available voices.",
  LIST_VOICES_PROVIDER:
    "Set this to HUME_AI to see the preset voices provided by Hume, instead of the custom voices in your account.",
  DELETE_VOICE: "Deletes a custom voice from your account's voice library",
  SAVE_VOICE:
    "Saves a generated voice to your Voice Library for reuse in future TTS requests.",
  SAVE_VOICE_GENERATION_ID:
    "The generationId of the voice to save, obtained from a previous TTS request.",
  SAVE_VOICE_NAME:
    "The name to assign to the saved voice. This name can be used in voiceName parameter in future TTS requests.",
};

const truncate = (str: string, maxLength: number) => {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + "...";
};

// Global map to store file paths by generationId
export const audioMap = new Map<string, string>();

let logFile: fs.FileHandle;

const log = (...args: any[]) => {
  console.error(...args);
  logFile?.write(JSON.stringify(args) + "\n");
};

const hume = new HumeClient({
  apiKey: process.env.HUME_API_KEY!,
});

export const ttsArgs = (descriptions: typeof DESCRIPTIONS) => ({
  utterances: z.array(
    z.object({
      text: z.string().describe(descriptions.TTS_UTTERANCE_TEXT),
      description: z
        .string()
        .optional()
        .describe(descriptions.TTS_UTTERANCE_DESCRIPTION),
      speed: z
        .number()
        .max(2.0)
        .min(0.5)
        .optional()
        .describe(descriptions.TTS_UTTERANCE_SPEED),
      trailingSilence: z
        .number()
        .min(0.0)
        .max(5.0)
        .describe(descriptions.TTS_UTTERANCE_TRAILING_SILENCE),
    }),
  ),
  voiceName: z.string().optional().describe(descriptions.TTS_VOICE_NAME),
  provider: z
    .enum(["HUME_AI", "CUSTOM_VOICE"])
    .optional()
    .describe(descriptions.TTS_PROVIDER),
  continuationOf: z.string().optional().describe(descriptions.TTS_CONTINUATION),
  quiet: z.boolean().default(false).describe(descriptions.TTS_QUIET),
});

export const TTSSchema = (descriptions: typeof DESCRIPTIONS) =>
  z.object(ttsArgs(descriptions));
export type TTSCall = z.infer<ReturnType<typeof TTSSchema>>;

export const ttsSuccess = (generationIds: Array<string>, text: string) => ({
  content: [
    {
      type: "text" as const,
      text: `Created audio for text: "${truncate(text, 50)}", generation ids: ${generationIds
        .map((g) => {
          const filePath = audioMap.get(g);
          return `${g} (file: ${filePath})`;
        })
        .join(", ")}`,
    },
  ],
});

export const handleTts = async ({
  continuationOf,
  voiceName,
  quiet,
  utterances: utterancesInput,
}: TTSCall): Promise<CallToolResult> => {
  const utterances: Array<PostedUtterance> = [];
  for (const utt of utterancesInput) {
    let utterance: PostedUtterance = {
      text: utt.text,
      description: utt.description ?? undefined,
      speed: utt.speed ?? undefined,
      trailingSilence: utt.trailingSilence ?? undefined,
    };
    if (voiceName) {
      utterance = {
        ...utterance,
        voice: { name: voiceName },
      };
    }
    utterances.push(utterance);
  }

  const context: PostedContextWithGenerationId | null = continuationOf
    ? { generationId: continuationOf }
    : null;
  const request: PostedTts = {
    utterances,
    stripHeaders: true,
    instantMode: true,
    ...(context ? { context } : {}),
  };

  const text = utterances.map((u) => u.text).join(" ");
  log(
    `Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
  );

  try {
    const tempDir = path.join(os.tmpdir(), "hume-tts");
    await fs.mkdir(tempDir, { recursive: true });

    const chunks: Array<{ audio: string; generationId: string }> = [];
    const files: Map<string, FileHandle> = new Map();

    const filePathOf = (generationId: string) =>
      path.join(tempDir, `${generationId}.wav`);
    const writeToFile = async (generationId: string, audioBuffer: Buffer) => {
      let fileHandle;
      if (!files.has(generationId)) {
        const filePath = filePathOf(generationId);
        log(`Writing to ${filePath}...`);
        fileHandle = await fs.open(filePath, "w");
        files.set(generationId, fileHandle);
        audioMap.set(generationId, filePath);
      } else {
        fileHandle = files.get(generationId);
      }
      await fileHandle!.write(audioBuffer);
    };

    const go = async (writeAudio: (audioBuffer: Buffer) => void) => {
      for await (const audioChunk of await hume.tts.synthesizeJsonStreaming(
        request,
      )) {
        log(
          `Received audio chunk: ${JSON.stringify(audioChunk, (k, _v) => (k === "audio" ? "[Audio Data]" : undefined))}`,
        );
        chunks.push(audioChunk);
        const { audio, generationId } = audioChunk;

        const buf = Buffer.from(audio, "base64");
        await Promise.all([writeToFile(generationId, buf), writeAudio(buf)]);
      }
    };
    if (quiet) {
      const noopWriteAudio = () => {};
      await go(noopWriteAudio);
    } else {
      await withStdinAudioPlayer(null, go);
    }

    await Promise.all(Array.from(files.values()).map((file) => file.close()));

    return ttsSuccess([...files.keys()], text);
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
};

export const playPreviousAudioSuccess = (
  generationId: string,
  filePath: string,
): CallToolResult => ({
  content: [
    {
      type: "text",
      text: `Played audio for generationId: ${generationId}, file: ${filePath}`,
    },
  ],
});
export const handlePlayPreviousAudio = async ({
  generationId,
}: {
  generationId: string;
}): Promise<CallToolResult> => {
  const filePaths = audioMap.get(generationId);
  if (!filePaths)
    return {
      content: [
        {
          type: "text",
          text: `No audio found for generationId: ${generationId}`,
        },
      ],
    };

  const filePath = filePaths[0];
  try {
    await fs.access(filePath);
  } catch {
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

  try {
    await playAudio(filePath);
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Error playing audio for generationId: ${generationId}: ${e}`,
        },
      ],
      isError: true,
    };
  }
  return playPreviousAudioSuccess(generationId, filePath);
};

export const handleListVoices = async ({
  provider,
  pageNumber,
  pageSize,
}: {
  provider: "HUME_AI" | "CUSTOM_VOICE";
  pageNumber: number;
  pageSize: number;
}): Promise<CallToolResult> => {
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
};

export const handleDeleteVoice = async ({
  name,
}: {
  name: string;
}): Promise<CallToolResult> => {
  try {
    log(`Deleting voice with name: ${name}`);
    await hume.tts.voices.delete({ name });
    return {
      content: [
        { type: "text", text: `Successfully deleted voice \"${name}\".` },
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
};

export const handleSaveVoice = async ({
  generationId,
  name,
}: {
  generationId: string;
  name: string;
}): Promise<CallToolResult> => {
  try {
    log(`Saving voice with generationId: ${generationId} as name: \"${name}\"`);
    const response = await hume.tts.voices.create({ generationId, name });
    return {
      content: [
        {
          type: "text",
          text: `Successfully saved voice \"${name}\" with ID: ${response.id}. You can use this name in future TTS requests with the voiceName parameter.`,
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
};

export const setup = (server: McpServer, descriptions: typeof DESCRIPTIONS) => {
  // Register TTS tool with expanded options
  server.tool("tts", descriptions.TTS_TOOL, ttsArgs(descriptions), handleTts);

  server.tool(
    "play_previous_audio",
    descriptions.PLAY_PREVIOUS_AUDIO,
    {
      generationId: z
        .string()
        .describe("The generationId of the audio to play"),
    },
    handlePlayPreviousAudio,
  );

  server.tool(
    "list_voices",
    descriptions.LIST_VOICES,
    {
      provider: z
        .enum(["HUME_AI", "CUSTOM_VOICE"])
        .default("CUSTOM_VOICE")
        .describe(descriptions.LIST_VOICES_PROVIDER),
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
    handleListVoices,
  );

  server.tool(
    "delete_voice",
    descriptions.DELETE_VOICE,
    {
      name: z.string().describe("The name of the voice to delete."),
    },
    handleDeleteVoice,
  );

  // Add save_voice tool to save a voice to the Voice Library
  server.tool(
    "save_voice",
    descriptions.SAVE_VOICE,
    {
      generationId: z.string().describe(descriptions.SAVE_VOICE_GENERATION_ID),
      name: z.string().describe(descriptions.SAVE_VOICE_NAME),
    },
    handleSaveVoice,
  );

  return server;
};

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

  logFile = await fs.open("/tmp/mcp-server-hume.log", "a");
  if (!process.env.HUME_API_KEY) {
    log("Please set the HUME_API_KEY environment variable.");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Hume MCP Server running on stdio");
};

process.on("exit", async () => {
  await logFile.close();
});

// Export function to create and configure the server
export const createHumeServer = () => {
  // Create server instance
  const server = new McpServer({
    name: "hume",
    version: "1.0.0",
  });

  // Configure all tools
  setup(server, DESCRIPTIONS);

  return server;
};

// Export function to get tool definitions without creating a full server
export const getHumeToolDefinitions = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<Array<Tool>> => {
  // Create a temporary server to extract tool definitions
  const server = new McpServer({
    name: "hume-tools",
    version: "1.0.0",
  });

  setup(server, descriptions);

  return (
    await (server.server as any)._requestHandlers.get("tools/list")({
      method: "tools/list",
    })
  ).tools as Array<Tool>;
};

if (require.main === module) {
  // If this file is run directly, start the server
  main().catch((error) => {
    log("Fatal error in main():", error);
    process.exit(1);
  });
}
