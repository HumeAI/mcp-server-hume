<div align="center">
  <img src="https://storage.googleapis.com/hume-public-logos/hume/hume-banner.png">
  <h1>Hume MCP Server</h1>
  <p>
    <strong>Collaborate with AI assistants on your Text-to-Speech projects</strong>
  </p>
  <p>
    <a href="https://dev.hume.ai/docs/text-to-speech-tts/mcp-server">📘 Documentation</a> •
    <a href="https://discord.com/invite/humeai">💬 Join us on Discord</a> •
    <a href="https://dev.hume.ai/docs/introduction/api-key">🔐 Getting your API Keys</a>
  </p>
</div>

The Hume [MCP](https://modelcontextprotocol.io) Server gives you the the ability to use [Octave Text to Speech](https://dev.hume.ai/docs/text-to-speech-tts/overview) from within an AI Chat, using an [MCP Client Application](https://modelcontextprotocol.io/clients) such as [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.sh/), or [Windsurf](https://www.windsurf.io/).

Octave TTS is the [first text-to-speech system built on LLM intelligence](https://www.hume.ai/blog/octave-the-first-text-to-speech-model-that-understands-what-its-saying). Octave is a speech-language model that understands what words mean in context, unlocking a new level of expressiveness and nuance. It *performs* the source text, it doesn't just pronounce it.

See [this video](https://www.loom.com/share/b9fb74163db44be28e9adcb61030e368) for a demonstration of using the MCP Server to narrate a scene from an audiobook.

## Quickstart

Click here to add to Cursor:

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=hume&config=eyJjb21tYW5kIjoibnB4IEBodW1lYWkvbWNwLXNlcnZlciIsImVudiI6eyJIVU1FX0FQSV9LRVkiOiIifX0%3D)

Copy the following into your client's MCP configuration (for example, inside the `.mcpServers` property of `claude_desktop_config.json` for Claude Desktop, or of the `mcp.json` for Cursor).

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
  --workdir, -w <path>       Set working directory for audio files (default: system temp)
  --(no-)embedded-audio-mode Enable/disable embedded audio mode (default: false)
  --(no-)instant-mode        Enable/disable instant mode (default: false) (incurs 10% additional cost)
  --help, -h                 Show this help message
```

## Evaluation Framework

The project includes a [comprehensive evaluation framework](src/evals/README.md) that measures how effectively AI agents can utilize the Hume TTS tools across various real-world scenarios.

## Environment Variables

- `HUME_API_KEY`: Your Hume AI API key (required)
- `WORKDIR`: Working directory for audio files (default: system temp directory + "/hume-tts")
- `EMBEDDED_AUDIO_MODE`: Enable/disable embedded audio mode (default: false, set to 'true' to enable)
- `INSTANT_MODE`: Enable/disable instant mode (default: false, set to 'true' to enable)
- `ANTHROPIC_API_KEY`: Required for running evaluations
