import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HumeClient } from "hume";
import type { Hume } from "hume"
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { CallToolResult, ListResourcesResult, ReadResourceResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { playAudioFile, getStdinAudioPlayer, AudioPlayer } from "./play_audio.js";
import { FileHandle } from "fs/promises";
import { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

// TODO: make this a command-line flag
const INSTANT_MODE = true
const CLAUDE_DESKTOP_MODE = process.env.CLAUDE_DESKTOP_MODE !== 'false'

const WORKDIR = process.env.WORKDIR ?? path.join(os.tmpdir(), "hume-tts");
const ensureWorkdir = async () => {
  return fs.mkdir(WORKDIR, { recursive: true });
}

const message = (text: string): CallToolResult['content'][number] => ({
  type: "text",
  text: JSON.stringify({ type: 'text', text }, null, 2),
})

const errorResult = (error: string): CallToolResult => ({
  content: [{
    type: "text",
    text: JSON.stringify({ type: 'error', error }, null, 2),
  }], isError: true
})
// Tool descriptions
export const DESCRIPTIONS = {
  TTS_TOOL:
    `Generates expressive speech from text, saves a single audio file to a temporary location, and plays it back through the user's speakers.
    
IMPORTANT GUIDELINES:
  1. ALWAYS provide "continuationOf" equal to the generation id of the previous TTS tool call unless you explicitly intend to speak with a different voice or you are narrating an entirely new body of text.
  2. ALWAYS determine whether you are providing *performance* or *dictation*. When providing *performance*, like designing a new voice or working on a creative project such as an audiobook, podcast, or video dub, you should work in smaller batches and ALWAYS stop for human feedback after each request. It often takes multiple iterations to get the best output. When providing *dictation* content, such as when the user wants to hear content read aloud for themselves, you should provide larger requests (3-5 paragraphs) and continue without feedback.
  3. When designing a new voice, provide "description" to match the users desired voice qualities (gender, accent, pitch, role, emotionality) and provide a "text" that also conveys the desired voice's style, emotion, and dialect. When designing a new voice, "text" need not be drawn from the source text the user ultimately wants spoken. Iterate based on user feedback.
  `,

  TTS_UTTERANCES: `Provide only a single utterance when designing a new voice. Break source text into multiple utterances when there is a need to provide "acting instructions" that vary across different parts of the text, or to insert "trailing_silence" within a text.`,
  TTS_UTTERANCE_TEXT: `The input text to be synthesized into speech. Modify source text with punctuation or CAPITALS for emotional emphasis, when appropriate.

  Remove unnecessary formatting symbols. Convert meaningful formatting -- like numbered lists -- into pronouncable markers like "first, second, third" -- when it is obvious how to do so. Best practice is to convert such text content into natural speech markers when it is obvious how to do so. Omit unpronouncable text such as large code snippets. Do not omit URLs, email addresses, and small code snippets like variable names, which can be pronounced. When omitting large blocks of unpronouncable content, such as code, best practice is to use a distinct voice (with a different TTS call) to speak a "placeholder" summarizing the omitted content in less than a sentence`,
  TTS_UTTERANCE_DESCRIPTION:
    `Natural language instructions describing how the synthesized speech should sound, including but not limited to tone, intonation, emotion, pacing, and accent (e.g., 'a soft, gentle voice with a strong British accent'). Always include this field when designing a new voice. When an existing voice is specified with 'voiceName', this field constitutes 'acting instructions' and should be provided when requested to modulate the voice's tone, emotion, etc.`,
  TTS_VOICE_NAME:
    "The name of the voice from the voice library to use as the speaker for the text.",
  TTS_PROVIDER:
    "Set this equal to HUME_AI when you wish to use a voice provided by Hume, and not among the custom voices saved to your voice library.",
  TTS_UTTERANCE_SPEED: "Alters the speaking rate of the voice. Usually unnecessary, the model automatically chooses an appropriate speaking rate according to the text and \"description\". Provide only when the model's default is unsatisfactory. Values range from 0.5 (very slow) to 2.0 (very fast).",
  TTS_UTTERANCE_TRAILING_SILENCE: "Manually adds silence (0-5 seconds) after an utterance. The model automatically inserts pauses where natural. Use this only when there is a desire to override the model's default pausing behavior.",
  TTS_CONTINUATION:
    "ALWAYS provide this field when continuing speech from a previous TTS call. This is important for both voice consistency and to make the prosody sound natural when continuing text.",
  TTS_QUIET: "Whether to skip playing back the generated audio.",
  PLAY_PREVIOUS_AUDIO:
    "Plays back previously generated audio by generationId. Since the TTS command already automatically plays generated audio. Use this tool only when explicitly requested to replay previous audio.",
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

class AudioRecord {
  private text: string;
  private generationId: string;
  constructor(
    text: string,
    generationId: string,
  ) {
    this.text = text;
    this.generationId = generationId;
  }
  pretty() {
    return `Audio("${truncate(this.text, 50)}")`;
  }
  filePath() {
    return path.join(WORKDIR, `${this.generationId}.wav`);
  }
  uri() {
    return `file://${this.filePath()}`;
  }
}

class State {
  private _byGenerationId = new Map<string, AudioRecord>();
  private _byFilePath = new Map<string, AudioRecord>();

  findByGenerationId(generationId: string): AudioRecord | null {
    return this._byGenerationId.get(generationId) ?? null;
  }

  addAudio(text: string, generationId: string): AudioRecord {
    const record = new AudioRecord(text, generationId)
    this._byGenerationId.set(generationId, record);
    this._byFilePath.set(record.filePath(), record);
    return record
  }

  list(): {name: string, uri: string}[] {
    return Array.from(this._byFilePath.values()).map((record) => ({
      name: record.pretty(),
      uri: record.uri(),
    }));
  }

  findByFilePath(filePath: string): AudioRecord | null {
    return this._byFilePath.get(filePath) ?? null;
  }
  findByUri(uri: string): AudioRecord | null {
    const filePath = uri.replace("file://", "");
    return this.findByFilePath(filePath);
  }
}

let logFile: fs.FileHandle;
export const setLogFile = (file: fs.FileHandle) => {
  logFile = file;


  process.on("exit", async () => {
    await logFile?.close();
  });
}

export const log = (...args: any[]) => {
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
        .optional()
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

const textAudioMessage = (record: AudioRecord): CallToolResult['content'][number] => ({
  type: "text",
  text: `Wrote ${record.pretty()} to ${record.filePath()}`,
})

const embeddedAudioMessage = (base64: string): CallToolResult['content'][number] => ({
  type: "audio",
  mimeType: "audio/wav",
  data: base64
})

export const ttsSuccess = (state: State, generationIdToAudio: Map<string, Buffer>): CallToolResult => {
  const messages: IteratorObject<{
    text: CallToolResult['content'][number],
    embedded: CallToolResult['content'][number],
  }> = generationIdToAudio.entries().map(([generationId, buf]) => {
    const text = textAudioMessage(state.findByGenerationId(generationId)!)
    const embedded = embeddedAudioMessage(buf.toString('base64'))
    return { text, embedded }
  })
  if (CLAUDE_DESKTOP_MODE) {
    return {
      content: [...messages.map(({ text }) => text)]
    }
  }
  return {
    content: [...messages.flatMap(({ text, embedded }) => [text, embedded])]
  }
};

export const handleTts = (state: State) => async (args: TTSCall): Promise<CallToolResult> => {
  const {
    continuationOf,
    voiceName,
    quiet,
    utterances: utterancesInput,
  } = args
  const utterances: Array<Hume.tts.PostedUtterance> = [];
  for (const utt of utterancesInput) {
    const utterance: Hume.tts.PostedUtterance = {
      text: utt.text,
    };
    if (utt.speed) {
      utterance.speed = utt.speed
    }
    if (utt.trailingSilence) {
      utterance.trailingSilence = utt.trailingSilence
    }
    if (utt.speed) {
      utterance.speed = utt.speed
    }
    if (utt.description) {
      utterance.description = utt.description
    }
    if (voiceName) {
      utterance.voice = { name: voiceName }
    }
    utterances.push(utterance);
  }

  const context: Hume.tts.PostedContextWithGenerationId | null = continuationOf
    ? { generationId: continuationOf }
    : null;
  const request: Hume.tts.PostedTts = {
    utterances,
    stripHeaders: true,
    instantMode: INSTANT_MODE && !voiceName && !continuationOf,
  };
  if (context) {
    request.context = context;
  }

  const text = utterances.map((u) => u.text).join(" ");
  log(
    `Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
  );

  await ensureWorkdir();

  const chunks: Array<{ audio: string; generationId: string }> = [];
  const files: Map<string, FileHandle> = new Map();
  const fileAudioData: Map<string, Buffer> = new Map();

  const filePathOf = (generationId: string) =>
    path.join(WORKDIR, `${generationId}.wav`);
  const writeToFile = async (generationId: string, audioBuffer: Buffer) => {
    let fileHandle;
    if (!files.has(generationId)) {
      const filePath = filePathOf(generationId);
      log(`Writing to ${filePath}...`);
      fileHandle = await fs.open(filePath, "w");
      files.set(generationId, fileHandle);
      state.addAudio(text, generationId);
    } else {
      fileHandle = files.get(generationId);
    }
    await fileHandle!.write(audioBuffer);
  };

  const audioPlayer: AudioPlayer = quiet ? {
    sendAudio: () => { },
    close: async () => { },
  } : getStdinAudioPlayer()
  let stream: Awaited<ReturnType<typeof hume.tts.synthesizeJsonStreaming>>

  try {
    log(JSON.stringify(request, null, 2))
    stream = await hume.tts.synthesizeJsonStreaming(request)
  } catch (e) {
    log(`Error synthesizing speech: ${e}`);
    log(`${JSON.stringify(request)}`);
    return errorResult(`Error synthesizing speech: ${e} + ${(e as any).trace}`)
  }
  for await (const audioChunk of stream) {
    log(
      `Received audio chunk: ${JSON.stringify(audioChunk, (k, _v) => (k === "audio" ? "[Audio Data]" : undefined))}`,
    );
    chunks.push(audioChunk);
    const { audio, generationId } = audioChunk;

    const buf = Buffer.from(audio, "base64");
    audioPlayer.sendAudio(buf)
    if (!fileAudioData.has(generationId)) {
      fileAudioData.set(generationId, buf);
    } else {
      const currentBuffer = fileAudioData.get(generationId);
      const newBuffer = Buffer.concat([currentBuffer || Buffer.alloc(0), buf]);
      fileAudioData.set(generationId, newBuffer);
    }
    await writeToFile(generationId, buf)
  }
  await Promise.all(Array.from(files.values()).map((file) => file.close()));
  await audioPlayer.close()

  return ttsSuccess(state, fileAudioData);
};

export const playPreviousAudioSuccess = (
  generationId: string,
  audioRecord: AudioRecord,
): CallToolResult => ({
  content: [
    message(`Played audio for generationId: ${generationId}, file: ${audioRecord.filePath()}`),
  ],
});
export const handlePlayPreviousAudio = (state: State) => async ({
  generationId,
}: {
  generationId: string;
}): Promise<CallToolResult> => {
  const audioRecord = state.findByGenerationId(generationId);
  if (!audioRecord) {
    return errorResult(`No audio found for generationId: ${generationId}`)
  }
  try {
    await fs.access(audioRecord.filePath());
  } catch {
    log(`File not found: ${audioRecord}`);
    return errorResult(`Audio file for generationId: ${generationId} was not found at ${audioRecord}`)
  }

  try {
    await playAudioFile(audioRecord.filePath());
  } catch (e) {
    return errorResult(`Error playing audio for generationId: ${generationId}: ${e}`)
  }
  return playPreviousAudioSuccess(generationId, audioRecord);
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
      content: [message(`Available voices:\n${voices.data.map((voice) => `${voice.name} (${voice.id})`).join("\n")}`)]
    };
  } catch (error) {
    log(
      `Error listing voices: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorResult(`Error listing voices: ${error instanceof Error ? error.message : String(error)}`)
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
        message(`Successfully deleted voice \"${name}\".`),
      ],
    };
  } catch (error) {
    log(
      `Error deleting voice: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorResult(`Error deleting voice: ${error instanceof Error ? error.message : String(error)}`)
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
        message(`Successfully saved voice \"${name}\" with ID: ${response.id}. You can use this name in future TTS requests with the voiceName parameter.`)
      ],
    };
  } catch (error) {
    log(
      `Error saving voice: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorResult(`Error saving voice: ${error instanceof Error ? error.message : String(error)}`)
  }
};

export const setup = (server: McpServer, descriptions: typeof DESCRIPTIONS) => {
  const state = new State()
  server.resource("tts audio", new ResourceTemplate(`file://${WORKDIR}/{generation_id}.wav`, {
    list: (): ListResourcesResult => {
      return {
        resources: state.list()
      }
    }
  }), async (_uri: URL, variables: Variables, _extra: unknown): Promise<ReadResourceResult> => {
    const record = state.findByGenerationId(variables['generation_id'] as string)
    if (!record) {
      throw new Error(`No audio found for generationId: ${variables['generation_id']}`)
    }
    const buf = Buffer.from(await fs.readFile(record.filePath()))
    return {
      contents: [{
        uri: record.uri(),
        mimeType: 'audio/wav',
        blob: buf.toString('base64')
      }]
    }
  })
  server.tool("tts", descriptions.TTS_TOOL, ttsArgs(descriptions), handleTts(state));

  server.tool(
    "play_previous_audio",
    descriptions.PLAY_PREVIOUS_AUDIO,
    {
      generationId: z
        .string()
        .describe("The generationId of the audio to play"),
    },
    handlePlayPreviousAudio(state),
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

// Export function to create and configure the server
export const createHumeServer = () => {
  // Create server instance
  const server = new McpServer({
    name: "hume",
    version: "0.1.0",
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
  server.sendResourceListChanged()

  return (
    await (server.server as any)._requestHandlers.get("tools/list")({
      method: "tools/list",
    })
  ).tools as Array<Tool>;
};
