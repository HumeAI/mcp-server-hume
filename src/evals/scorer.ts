import Anthropic from "@anthropic-ai/sdk";
import { RoleplayResult, TranscriptEntry } from "./roleplay.js";

export type Criteria = Record<string, string>;

export type ScoredCriterion = {
  name: string;
  description: string;
  score: number | "n/a";
  reason: string;
};

export const scoreCriteria = async (
  apiKey: string,
  criteria: Criteria,
  data: {
    transcript: TranscriptEntry[];
    result: RoleplayResult | "incomplete";
  },
): Promise<ScoredCriterion[]> => {
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    tools: [
      {
        name: "score",
        description:
          "Evaluate an AI agent's performance in a chat transcript. Provide 'n/a' as the score if the criterion is not applicable to this transcript. Provide a 1.0 score if every example shows the agent fulfilling the criterion perfectly. Provide a score no higher than 0.5 if there is a single example of the agent failing to fulfill the criterion. Provide a low score between 0.0 and 0.3 if there are several examples of the agent failing to fulfill the criterion.",
        input_schema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(criteria).map(([name, description]) => [
              name,
              {
                type: "object",
                nullable: true,
                properties: {
                  score: { 
                    oneOf: [
                      { type: "number", minimum: 0, maximum: 1 },
                      { type: "string", enum: ["n/a"] }
                    ],
                    description: "Numeric score between 0 and 1, or 'n/a' if not applicable"
                  },
                  reason: {
                    type: "string",
                    description:
                      "Summarize what the agent did that caused it to receive the score, or why the criterion is not applicable",
                  },
                  examples: {
                    type: "string",
                    description:
                      "Provide (appropriately redacted/paraphrased) examples from the transcript showing undesired behavior from the agent. Use this only for scores less than 0.9",
                  },
                },
                required: ["score", "reason"],
                description,
              },
            ]),
          ),
          required: Object.keys(criteria),
        },
      },
    ],
    tool_choice: { type: "tool", name: "score" },
    messages: [
      {
        role: "user",
        content: `Here's a transcript of a conversation between a user (roleplayer) and an AI agent:

${JSON.stringify(data.transcript, null, 2)}

Please evaluate the agent's performance.`,
      },
    ],
  });

  // Extract score results
  let scores: Record<string, { score: number | "n/a"; reason: string }> = {};

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "score") {
      scores = block.input as Record<string, { score: number | "n/a"; reason: string }>;
      break;
    }
  }

  // Convert to ScoredCriterion array
  return Object.entries(criteria).map(([name, description]) => {
    // Handle case where the score is not provided
    const scoreResult = scores[name];
    if (!scoreResult) {
      return {
        name,
        description,
        score: 0,
        reason: "No score provided by evaluator"
      };
    }
    
    return {
      name,
      description,
      score: scoreResult.score,
      reason: scoreResult.reason || "No reason provided"
    };
  });
};
