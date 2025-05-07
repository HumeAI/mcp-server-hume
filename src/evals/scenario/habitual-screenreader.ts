import * as fs from "fs/promises";
import * as path from "path";
import { DESCRIPTIONS } from "../../server.js";
import { getHumeMcpTools } from "../utils.js";
import { commonCriteria, commonInstructions } from "./common.js";
import {
  getContent,
  handler,
  mockDisplayResult,
  mockDisplayUse,
} from "./mock.js";
import { EvalScenario } from "../roleplay.js";

export const habitualScreenreaderScenario = async (
  descriptions: typeof DESCRIPTIONS,
): Promise<EvalScenario> => {
  const blogParagraphs = (
    await fs.readFile(
      path.join(__dirname, "/../data/metasyntactic_blog_post.txt"),
      "utf-8",
    )
  ).split("\n\n");

  return {
    roleplay: {
      name: "Habitual Screenreader",
      tools: {
        ...(await getHumeMcpTools({
          descriptions,
          handler,
          displayUse: mockDisplayUse,
          displayResult: mockDisplayResult,
        })),
        get_content: getContent(
          "This tool is able to retrieve sections of the blog post at https://metasyntactic-institute.org/blog/guide",
          {
            firstContent: blogParagraphs[0] + "\n\n" + blogParagraphs[1],
            secondContent:
              blogParagraphs[2] +
              "\n\n" +
              blogParagraphs[3] +
              blogParagraphs[4] +
              "\n\n" +
              blogParagraphs[5],
            lastParagraph: blogParagraphs[blogParagraphs.length - 1],
          },
        ),
      },
      initialMessage: `<userPreferences>When you use TTS always use the "Ava Song" voice provided by HUME_AI.</userPreferences>
can you read me the blog post at https://metasyntactic-institute.org/blog/guide`,
      roleplayerPrompt: `You are roleplaying a user conversing with an AI agent. You are someone who regularly uses this service and has a preferred voice that you like to use.

      You will start by asking the agent to read a blog post. You expect the agent to remember your voice preference "AVA SONG" that you have specified.

      ${commonInstructions}
      
      End the roleplay when the blog post has been read to you in your preferred voice, or when you become frustrated with the agent.
      `,
    },
    criteria: {
      ...commonCriteria,
      voice_preference_honored:
        "The agent should use a voice description that matches the user's stated preference for a 'AVA SONG'.",
    },
    maxTurns: 20,
  };
};
