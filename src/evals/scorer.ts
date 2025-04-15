import Anthropic from "@anthropic-ai/sdk";
import { TranscriptEntry } from './roleplay.js';

export type Criteria = Record<string, string>;

export type ScoredCriterion = {
  name: string;
  description: string;
  score: number;
  reason: string;
};


export const scoreCriteria = async (
  apiKey: string,
  criteria: Criteria,
  data: { transcript: TranscriptEntry[], result: any }
): Promise<ScoredCriterion[]> => {
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4000,
    tools: [{
      name: "score",
      description: "Evaluate an AI agent's performance in a chat transcript. Provide a `null` score if there are no examples of the agent fulfilling or failing to fulfill a criterion. Provide a 1.0 score if every example shows the agent fulfilling the criterion perfectly. Provide a score no higher than 5.0 if there is a single example of the agent failing to fulfill the criterion. Provide a low score between 0.0 and 3.0 if there are several examples of the agent failing to fulfill the criterion.",
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(criteria).map(([name, description]) => [
            name,
            {
              type: 'object',
              nullable: true,
              properties: {
                score: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string', description: 'Summarize what the agent did that caused it to receive the score' },
                examples: { type: 'string', description: 'Provide (appropriately redacted/paraphrased) examples from the transcript showing undesired behavior from the agent. Use this only for scores less than 0.9' }
              },
              required: ['score', 'reason'],
              description
            }
          ])
        ),
        required: Object.keys(criteria)
      }
    }],
    tool_choice: { type: "tool", name: "score" },
    messages: [
      {
        role: "user",
        content: `Here's a transcript of a conversation between a user (roleplayer) and an AI agent:

${JSON.stringify(data.transcript, null, 2)}

Please evaluate the agent's performance.`
      }
    ]
  });

  // Extract score results
  let scores: Record<string, { score: number, reason: string }> = {};

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'score') {
      scores = block.input as Record<string, { score: number, reason: string }>;
      break;
    }
  }

  // Convert to ScoredCriterion array
  return Object.entries(criteria).map(([name, description]) => ({
    name,
    description,
    score: scores[name]?.score ?? 0,
    reason: scores[name]?.reason ?? "No score provided"
  }));
};
