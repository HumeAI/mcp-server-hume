import * as fs from "fs/promises";
import { TranscriptEntry } from "./roleplay.js";
import { EvalResult } from "./scenario/types.js";

const MAX_TEXT_LENGTH = 60;
const MAX_MESSAGE_LENGTH = 500

const textTruncatingReplacer = (key: string, value: unknown): unknown => {
  if (key === 'text' && typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
    return truncateMiddle(value, MAX_TEXT_LENGTH);
  }
  return value;
}

const stringify = (obj: unknown): string => {
  return JSON.stringify(obj, textTruncatingReplacer, 2);
}

export const formatTranscript = (transcript: TranscriptEntry[]): string => {
  const lines: string[] = [];

  for (const entry of transcript) {
    switch (entry.type) {
      case "spoke":
        if (entry.speaker === "agent") {
          lines.push(`<- "${truncateMiddle(entry.content || "", MAX_MESSAGE_LENGTH)}"`);
        } else if (entry.speaker === "roleplayer") {
          lines.push(`-> "${truncateMiddle(entry.content || "", MAX_MESSAGE_LENGTH)}"`);
        }
        break;
      case "tool_use":
        lines.push(`<- ToolCall(${entry.name}, ${stringify(entry.input)})`);
        break;
      case "tool_result":
        lines.push(`-> ToolResponse(${stringify(entry.content)})`);
        break;
    }
  }

  return lines.join("\n");
};

const truncateMiddle = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  const halfLength = Math.floor(maxLength / 2);
  const beginning = text.substring(0, halfLength);
  const end = text.substring(text.length - halfLength);

  return beginning + '...' + end;
};

export const formatEvalResult = (evalResult: EvalResult): string => {
  const outputLines: string[] = [];
  const out = (text: string) => {
    outputLines.push(text);
  }
  const linebreak = () => {
    outputLines.push("");
  }
  const heading = (title: string) => {
    out(title);
    out("=".repeat(title.length));
  }

  heading("Result");

  if (evalResult.result === "incomplete") {
    out("Incomplete");
    out("Evaluation did not complete");
  } else {
    out(evalResult.result.status);
    if (evalResult.result.reason) {
      out(evalResult.result.reason);
    }
  }
  linebreak()
  heading("Transcript");

  out(formatTranscript(evalResult.transcript));
  linebreak()

  heading("Scores")
  for (const score of evalResult.scores) {
    out(`${score.name}: ${score.score}`);
    out(`  ${score.reason}`);
    linebreak();
  }

  return outputLines.join("\n");
};

export const prettyPrintFile = async (filePath: string): Promise<void> => {
  try {
    await fs.access(filePath);

    const content = await fs.readFile(filePath, "utf-8");
    const evalResult = JSON.parse(content) as EvalResult;

    const formattedResult = formatEvalResult(evalResult);
    console.log(formattedResult);

  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};
