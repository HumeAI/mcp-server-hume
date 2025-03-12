import { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuid } from "uuid";
import { DESCRIPTIONS, TTSSchema } from "../../server.js";
import { ScenarioTool } from "../roleplay.js";

// Mock implementation for the eval tests
class MockAudioRecord {
  private text: string;
  private generationId: string;

  constructor(text: string, generationId: string) {
    this.text = text;
    this.generationId = generationId;
  }

  pretty() {
    return `Audio("${this.text.substring(0, 50)}")`;
  }

  filePath() {
    return `/tmp/hume-tts/${this.generationId}.wav`;
  }

  uri() {
    return `file://${this.filePath()}`;
  }
}

class MockState {
  private _byGenerationId = new Map<string, MockAudioRecord>();
  private _byFilePath = new Map<string, MockAudioRecord>();

  findByGenerationId(generationId: string): MockAudioRecord | null {
    return this._byGenerationId.get(generationId) ?? null;
  }

  addAudio(text: string, generationId: string): MockAudioRecord {
    const record = new MockAudioRecord(text, generationId);
    this._byGenerationId.set(generationId, record);
    this._byFilePath.set(record.filePath(), record);
    return record;
  }
}

// Mock functions for tts success and play previous audio
const mockTtsSuccess = (
  state: MockState,
  generationIdToAudio: Map<string, Buffer>,
): CallToolResult => {
  return {
    content: Array.from(generationIdToAudio.entries()).map(
      ([generationId, _]) => ({
        type: "text" as const,
        text: `Wrote audio to ${state.findByGenerationId(generationId)?.filePath()}`,
      }),
    ),
  };
};

const mockPlayPreviousAudioSuccess = (
  generationId: string,
  audioRecord: MockAudioRecord,
): CallToolResult => ({
  content: [
    {
      type: "text" as const,
      text: `Played audio for generationId: ${generationId}, file: ${audioRecord.filePath()}`,
    },
  ],
});

// Common utility functions
export const handler = async (
  toolName: string,
  input: unknown,
): Promise<CallToolResult> => {
  const mockState = new MockState();

  if (toolName === "tts") {
    console.log(toolName, input);
    const text = TTSSchema(DESCRIPTIONS)
      .parse(input)
      .utterances.map((u) => u.text)
      .join(" ");
    const generationId = uuid();
    const audioRecord = mockState.addAudio(text, generationId);
    const audioMap = new Map<string, Buffer>();
    audioMap.set(generationId, Buffer.from("mock audio data"));
    return mockTtsSuccess(mockState, audioMap);
  }

  if (toolName === "play_previous_audio") {
    const generationId = (input as any).generationId;
    const audioRecord = mockState.addAudio("mock audio", generationId);
    return mockPlayPreviousAudioSuccess(generationId, audioRecord);
  }
  if (toolName === "list_voices") {
    return {
      content: [
        { type: "text", text: `Available voices: ${JSON.stringify(input)}` },
      ],
    };
  }
  if (toolName === "save_voice") {
    return {
      content: [
        {
          type: "text",
          text: `Voice saved with name: ${JSON.stringify(input)}`,
        },
      ],
    };
  }
  throw new Error(`Unknown tool name: ${toolName}`);
};

export const mockDisplayUse = (input: unknown): string =>
  `<AGENT REQUESTED CONTENT ${JSON.stringify(input)}>`;
export const mockDisplayResult = (_input: unknown): string =>
  `<AGENT RECEIVED CONTENT>`;

// Create a content retrieval tool for the scenarios
export const getContent = (
  description: string,
  content: Record<string, string>,
): ScenarioTool => {
  const sections = Object.keys(content);

  return {
    description,
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: sections,
          description: `The name of the section to retrieve content from. Available sections: ${sections.join(", ")}`,
        },
      },
      required: ["section"],
    },
    displayUse: (input: unknown): string => {
      return `<AGENT REQUESTED CONTENT ${(input as any).section}>`;
    },
    displayResult: (_input): string => {
      return `<AGENT RECEIVED CONTENT>`;
    },
    handler: async (input): Promise<ToolResultBlockParam["content"]> => {
      const section = (input as any).section;
      if (!section) {
        return [
          {
            type: "text",
            text: `Error: section must be specified. Available sections: ${sections.join(", ")}`,
          },
        ];
      }

      if (!(section in content)) {
        return [
          {
            type: "text",
            text: `Error: section "${section}" not found. Available sections: ${sections.join(", ")}`,
          },
        ];
      }

      return [
        {
          type: "text",
          text: content[section],
        },
      ];
    },
  };
};
