import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/index.mjs";

// Define speaker types
type Speaker = "roleplayer" | "tooluser";

// Define transcript entry type
interface TranscriptEntry {
  speaker: Speaker;
  content: string;
}

// Define scenario type
interface Scenario {
  name: string;
  description: string;
  roleplayerPrompt: string;
  tooluserPrompt: string;
  initialMessage: string;
}

// Poet scenario
const POET_SCENARIO: Scenario = {
  name: "AI Poet",
  description: "A poet seeking feedback on their poetry",
  roleplayerPrompt: `You are a poet seeking feedback on your poetry.
Start by introducing yourself and sharing this poem:

Title: Whispers of Dawn

The morning light breaks through the veil,
A golden touch on silver dew.
The world awakens from its dream,
As shadows fade to skies of blue.

Birds announce the day's arrival,
Their melodies both sweet and clear.
The gentle rustle of the leaves,
A symphony for those who hear.`,
  tooluserPrompt: `You are an AI assistant helping a poet with their work.`,
  initialMessage: "Introduce yourself and share your poem."
};

// Voice designer scenario
const VOICE_DESIGNER_SCENARIO: Scenario = {
  name: "Voice Designer",
  description: "User wants to design a voice for their video game character",
  roleplayerPrompt: `You are a video game developer seeking help to design the perfect voice for your main character.
Your character is a wise, ancient forest guardian who protects the natural world.
You want to find a voice that conveys both wisdom and a connection to nature.

Ask specific questions about voice characteristics like tone, accent, pacing, and emotional qualities.
Be detailed in your requirements and give feedback on suggestions.`,
  tooluserPrompt: `You are an AI assistant with expertise in voice design.
Help the user design the perfect voice for their video game character.
Suggest voice characteristics and provide detailed descriptions.
Ask clarifying questions to understand their requirements better.`,
  initialMessage: "Help me design a voice for my video game character."
};

// Define conversation class with async iterator
class Conversation implements AsyncIterable<TranscriptEntry> {
  private anthropic: Anthropic;
  private internalTranscript: TranscriptEntry[] = [];
  private nextSpeaker: Speaker = "roleplayer";
  private scenario: Scenario;
  private model: string;
  
  constructor(apiKey: string, scenario: Scenario, model = "claude-3-5-haiku-latest") {
    if (!apiKey) {
      throw new Error("API key is required");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.scenario = scenario;
    this.model = model;
  }
  
  // Get the current transcript
  get transcript(): ReadonlyArray<TranscriptEntry> {
    return [...this.internalTranscript];
  }
  
  // Initialize conversation with roleplayer's first message
  async initialize(): Promise<TranscriptEntry> {
    console.error(`Initializing conversation for scenario: ${this.scenario.name}`);
    
    const initialResponse = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: this.scenario.roleplayerPrompt,
      messages: [{ role: "user", content: this.scenario.initialMessage }]
    });
    
    const initialMessage = initialResponse.content
      .filter(block => block.type === "text")
      .map(block => (block as any).text)
      .join("");
    
    const entry: TranscriptEntry = {
      speaker: "roleplayer",
      content: initialMessage
    };
    
    this.internalTranscript.push(entry);
    this.nextSpeaker = "tooluser";
    
    console.log(`Roleplayer: ${initialMessage}`);
    return entry;
  }
  
  // Advance the conversation to the next turn
  async next(): Promise<TranscriptEntry | null> {
    if (this.internalTranscript.length === 0) {
      return this.initialize();
    }
    
    const currentSpeaker = this.nextSpeaker;
    console.error(`Next turn: ${currentSpeaker}'s turn`);
    
    let messages: MessageParam[] = [];
    let systemPrompt: string;
    
    // Prepare messages based on who's speaking next
    if (currentSpeaker === "tooluser") {
      // When it's tooluser's turn, messages from roleplayer are "user" messages
      systemPrompt = this.scenario.tooluserPrompt;
      
      for (const entry of this.internalTranscript) {
        if (entry.speaker === "roleplayer") {
          messages.push({ role: "user", content: entry.content });
        } else {
          messages.push({ role: "assistant", content: entry.content });
        }
      }
    } else {
      // When it's roleplayer's turn, messages from tooluser are "user" messages
      systemPrompt = this.scenario.roleplayerPrompt;
      
      for (const entry of this.internalTranscript) {
        if (entry.speaker === "tooluser") {
          messages.push({ role: "user", content: entry.content });
        } else {
          messages.push({ role: "assistant", content: entry.content });
        }
      }
    }
    
    // Get response from the current speaker
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    });
    
    const messageContent = response.content
      .filter(block => block.type === "text")
      .map(block => (block as any).text)
      .join("");
    
    // Create and add the new entry
    const entry: TranscriptEntry = {
      speaker: currentSpeaker,
      content: messageContent
    };
    
    this.internalTranscript.push(entry);
    
    // Toggle next speaker
    this.nextSpeaker = currentSpeaker === "roleplayer" ? "tooluser" : "roleplayer";
    
    // Output to console
    console.log(`${currentSpeaker}: ${messageContent}`);
    
    return entry;
  }
  
  // Convert internal transcript to API format
  toApiFormat(): MessageParam[] {
    const apiTranscript: MessageParam[] = [];
    let currentRole = "user"; // Start with user role
    
    for (const entry of this.internalTranscript) {
      apiTranscript.push({
        role: currentRole,
        content: entry.content
      });
      // Toggle role for next message
      currentRole = currentRole === "user" ? "assistant" : "user";
    }
    
    return apiTranscript;
  }
  
  // Implement AsyncIterator interface
  async *[Symbol.asyncIterator](): AsyncIterator<TranscriptEntry> {
    // Initialize if not already done
    if (this.internalTranscript.length === 0) {
      yield await this.initialize();
    }
    
    // Continue indefinitely (caller decides when to stop)
    while (true) {
      const entry = await this.next();
      if (entry) {
        yield entry;
      } else {
        break;
      }
    }
  }
}

// Run conversation using for-await-of syntax
async function runConversationWithIterator(
  scenario: Scenario = POET_SCENARIO, 
  maxTurns: number = 5
): Promise<MessageParam[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  
  const conversation = new Conversation(apiKey, scenario);
  let count = 0;
  
  for await (const entry of conversation) {
    count++;
    if (count >= maxTurns) break;
  }
  
  return conversation.toApiFormat();
}

// Run conversation by calling next explicitly
async function runConversationIteratively(
  scenario: Scenario = POET_SCENARIO
): Promise<MessageParam[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }
  
  const conversation = new Conversation(apiKey, scenario);
  
  // Gets first message automatically with initialize()
  await conversation.next(); // Tooluser responds to initial message
  await conversation.next(); // Roleplayer responds
  await conversation.next(); // Tooluser responds
  await conversation.next(); // Roleplayer responds
  await conversation.next(); // Tooluser responds
  
  return conversation.toApiFormat();
}

// Main function
async function main() {
  try {
    console.error(`Starting conversation for scenario: ${POET_SCENARIO.name}`);
    
    // Choose which approach to use
    const transcript = await runConversationWithIterator(POET_SCENARIO, 5);
    // const transcript = await runConversationIteratively(POET_SCENARIO);
    
    console.error("\nConversation complete.");
    console.log(JSON.stringify(transcript, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error("Error running conversation:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main();
}

export { 
  Conversation, 
  Scenario, 
  POET_SCENARIO,
  VOICE_DESIGNER_SCENARIO,
  runConversationWithIterator, 
  runConversationIteratively 
};