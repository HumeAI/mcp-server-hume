Scenario: Simple screenreader

Description: User wants a webpage from the Internet spoken to them
Servers available: fetch, web search
Input transcript:

User: <expresses intent>
Assistant: tool web search <query>
Assistant: tool fetch <url>


 Expected tool calls: [several tts invocations with quiet: false, no voice, and continuation applied sequentially]


Scenario: Picky screenreader

Description: User wants a webpage spoken to them but doesn't like the voice
Servers available: fetch, web search
Input transcript:

User: <expresses intent>
Assistant: tool web search <query>
Assistant: tool fetch <url>
User: <expresses dislike of voice>


Expected tool calls: [list_voices, followed by tts invocations with a new voice]


Scenario: Habitual screenreader

Description: User wants a webpage spoken to them with their preferred voice
Servers available: fetch, web search
Input transcript:

User: <expresses intent with voice preference>
Assistant: tool web search <query>
Assistant: tool fetch <url>


Expected tool calls: [tts invocations with specified voice and continuation applied sequentially]


Scenario: Voice designer

Description: User wants to design a perfect voice for their video game character
Servers available: tts
Input transcript:

User: <expresses intent>
Assistant: <suggests voice characteristics>
User: <provides feedback>


Expected tool calls: [multiple tts invocations with varying descriptions to test options]


Scenario: Voice explorer

Description: User wants to find a suitable voice from Hume's provided voices
Servers available: tts, list_voices
Input transcript:

User: <expresses intent>
Assistant: <offers to help explore voices>


Expected tool calls: [list_voices with provider: "HUME_AI", followed by tts invocations to demonstrate options]


Scenario: AI Poet

Description: User wants their poem/short-story narrated
Servers available: tts
Input transcript:

User: <shares poem/story>
Assistant: <offers to narrate>


Expected tool calls: [tts invocations with appropriate voice description to match the tone/style of the poem/story]


Scenario: AI Playwright

Description: User wants to generate and hear dialogue for a play as they collaborate
Servers available: tts
Input transcript:

User: <describes play concept>
Assistant: <suggests dialogue>
User: <requests to hear it>


Expected tool calls: [multiple tts invocations with different voice descriptions for different characters]
