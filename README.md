# MCP Server Hume

A Model Context Protocol (MCP) server implementation for Hume AI's text-to-speech service, enabling AI agents to interact with Hume's TTS capabilities through a standardized interface.

## Features

- Synthesize speech from text with customizable voices and parameters
- Save, manage, and reuse voice profiles
- Stream audio generation and playback
- Support for continuation in long-form content
- Cross-platform audio playback via ffplay

## Prerequisites

- [Bun](https://bun.sh/) JavaScript runtime
- [ffplay](https://ffmpeg.org/ffplay.html) for audio playback (part of ffmpeg)
- Hume AI API key

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd mcp-server-hume

# Install dependencies
bun install
```

## Usage

### Run the MCP Server

```bash
# Run with your Hume API key
HUME_API_KEY=your_key_here bun index.js

# Run with custom working directory
HUME_API_KEY=your_key_here WORKDIR=/path/to/custom/dir bun index.js

# Or use command line options
HUME_API_KEY=your_key_here bun index.js --workdir /path/to/custom/dir --claude-desktop-mode false
```

### Command Line Options

```
Options:
  --workdir <path>           Set the working directory for audio files
  --claude-desktop-mode      Enable Claude desktop mode (true/false)
  --help, -h                 Show help message
```

### Available Tools

The server exposes the following MCP tools:

- **tts**: Synthesize speech from text
- **play_previous_audio**: Replay previously generated audio
- **list_voices**: List available voices
- **save_voice**: Save a generated voice to your library
- **delete_voice**: Remove a voice from your library

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

## Architecture

- **MCP Server**: Implements the Model Context Protocol for standardized tool interactions
- **TTS Integration**: Connects to Hume's TTS API for speech synthesis
- **Audio Management**: Handles generation, storage, and playback of audio files

## Environment Variables

- `HUME_API_KEY`: Your Hume AI API key (required)
- `WORKDIR`: Working directory for audio files (default: OS temp directory + "/hume-tts")
- `CLAUDE_DESKTOP_MODE`: Enable/disable Claude desktop mode (default: true, set to 'false' to disable)
- `ANTHROPIC_API_KEY`: Required for running evaluations

## License

ISC