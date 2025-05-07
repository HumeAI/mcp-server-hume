import * as fs from "fs/promises";
import * as path from "path";

const specialSymbolsCriteria =
  "The agent should not include symbols within utterance text, besides standard punctuation like commas, exclamation points, quotes, dashes, etc. The agent should replace non-pronouncable symbols with natural speech that communicates the same intent, if it is obvious how. If there is no obvious way to represent the special symbols in natural language, the assistant should either ask the user for instructions first, or replace the unpronounceable text with a fitting placeholder in the text input.";
const emojiCriteria =
  "The agent should replace emojis in utterance text with natural language that describes the emoji when contextually appropriate, or redact them when not.";
const numberedListsCriteria =
  "Numbered lists item should be listed using natural language like 'first, second, third...' within utterance text.";
const codeSnippetCriteria =
  "The agent should not include multi-line code snippets within utterance text. Single variable names should be pronounced within paragraphs of prose. It is preferred to summarize the content or functionality of the code snippet without using the variable names when effective summarization is possible without including the variable names.";

export const commonCriteria = {
  tts_used: "The agent should use the tts tool to play back the content.",
  avoid_unnecessary_confirmation:
    "The agent should not ask for confirmation to do something the user has already asked for.",
  avoid_repeated_playback:
    "The agent should not play the same content multiple times, unless requested. For example, the agent should not unnecessarily call the `play_previous_audio` tool after calling the `tts` call.",
  incremental_playback:
    "Each utterance passed to the tts tool should be no longer than a single paragraph. Each call to the tts tool should be no longer than three paragraphs.",
  continuation_used_properly:
    "If there are multiple calls to the tts tool that draw from the same source text, the agent should specify the continuationOf parameter from all calls except for the initial one. The agent should NOT use continuationOf when switching between source texts.",
  unpronounceable_text: `
    ${specialSymbolsCriteria}
    ${emojiCriteria}
    ${numberedListsCriteria}
    ${codeSnippetCriteria}
  `,
};

// Common prompt instructions — injected into the system prompt for the "user"
const beTerseInstructions =
  "Use abbreviations, express your intent in as few information-dense sentences as possible, as if you were typing on a phone.";
const endRoleplayIfOffTrackInstructions =
  "If the agent has failed to follow your instructions and move you closer to your goal in the last 2 turns, use the end_roleplay tool to end the session.";
const singleToolInstructions = `You have access to a single tool 'end_roleplay'. Inside the transcript, you will see records of tool calls. DO NOT use any tool besides 'end_roleplay' yourself. You will see records of other tools in your transcript -- these are tools available to the AGENT, not you. You should NOT consider the text to have been read out loud to you unless there has been an appropriate call to the tts tool.`;

export const commonInstructions = `
  ${beTerseInstructions}
  ${endRoleplayIfOffTrackInstructions}
  ${singleToolInstructions}
`;

// Common prompt criteria — provided to the scorer assistant at the end of the chat
const voiceDesignText = await fs.readFile(
  path.join(__dirname, "/../data/voice_design.txt"),
  "utf-8",
);
export const voiceDesignCriteria = {
  voice_design_well_done: `When crafting voice descriptions, or presenting the user with voice options, or guiding the user through the process of voice design, the agent should abide by the following directions:\n\n ${voiceDesignText}`,
};
