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
