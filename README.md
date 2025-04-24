# @humeai/mcp-server-hume

Implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) for Hume AI's Octave Text-To-Speech.

Octave TTS is [the world's best performing, expressive Speech LLM](https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying). It understands and *performs* the source text, it doesn't just pronounce it.

The Hume MCP Server allows you to use MCP Clients like [Claude Desktop](https://claude.ai/desktop), [Cursor](https://cursor.sh/), [Windsurf](https://www.windsurf.io/) to collaborate with AI assistants on your voice projects.

## Quickstart

Copy the following code into your client's MCP configuration (for example, inside the `.mcpServer` property of the `claude_desktop.json` or the equivalent)

```json
{
    ...
    "hume": {
        "command": "npx",
        "args": [
            "@humeai/mcp-server"
        ],
        "env": {
            "HUME_API_KEY": "<your_hume_api_key>",
        }
    }
}
```

## Prerequisites
- An account and API Key from [Hume AI](https://platform.hume.ai/)
- [Node.js](https://nodejs.org/)
- (optional) A command-line audio player
  * [ffplay](https://ffmpeg.org/ffplay.html) from FFMpeg is recommended, but the server will attempt to detect and use any of several common players.

### Available Tools

The server exposes the following MCP tools:

- **tts**: Synthesize (and play) speech from text
- **play_previous_audio**: Replay previously generated audio
- **list_voices**: List available voices
- **save_voice**: Save a generated voice to your library
- **delete_voice**: Remove a voice from your library

### Command Line Options

```
Options:
  --workdir <path>           Set the working directory for audio files
  --embedded-audio-mode      Enable embedded audio mode (true/false)
  --help, -h                 Show help message
```


## Development

```bash
# Build the project
bun run build

# Run TypeScript files directly
bun run src/path/to/file.ts

# Type check
bunx tsc --noEmit
```

## Evaluation Framework

The project includes a [comprehensive evaluation framework](src/evals/README.md) that measures how effectively AI agents can utilize the Hume TTS tools across various real-world scenarios.

## Environment Variables

- `HUME_API_KEY`: Your Hume AI API key (required)
- `WORKDIR`: Working directory for audio files (default: OS temp directory + "/hume-tts")
- `EMBEDDED_AUDIO_MODE`: Enable/disable embedded audio mode (default: false, set to 'true' to enable)
- `ANTHROPIC_API_KEY`: Required for running evaluations
