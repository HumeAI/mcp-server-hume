import { Conversation, POET_SCENARIO, VOICE_DESIGNER_SCENARIO } from './two_llm_chat.js';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const scenarioName = args[0] || 'poet';
  const maxTurns = parseInt(args[1] || '5', 10);
  
  // Select scenario based on input
  const scenario = scenarioName.toLowerCase() === 'voice' 
    ? VOICE_DESIGNER_SCENARIO 
    : POET_SCENARIO;
  
  console.error(`Running scenario: ${scenario.name} for ${maxTurns} turns`);
  
  // Create conversation
  const conversation = new Conversation(apiKey, scenario);
  
  // Use async iterator pattern
  let count = 0;
  for await (const entry of conversation) {
    count++;
    if (count >= maxTurns) {
      console.error(`Reached maximum turns (${maxTurns}). Stopping.`);
      break;
    }
  }
  
  // Output final transcript
  console.error("\nConversation complete. Final transcript:");
  console.log(JSON.stringify(conversation.transcript, null, 2));
  
  process.exit(0);
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error("Error:", error);
    process.exit(1);
  });
}