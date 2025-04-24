#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HumeServer } from "./server.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import meow from "meow";

const cli = meow(
  `
  Usage
    $ bunx @humeai/mcp-server [options]

  Options
    --workdir, -w <path>      Set working directory for audio files (default: $WORKDIR or system temp)
    --embedded-audio-mode     Enable/disable embedded audio mode (default: $EMBEDDED_AUDIO_MODE or false)
    --help, -h                Show this help message

  Environment variables
    WORKDIR                   Alternative to --workdir
    EMBEDDED_AUDIO_MODE       Alternative to --embedded-audio-mode (set to 'true' to enable)
    HUME_API_KEY              Required Hume API key
`,
  {
    importMeta: import.meta,
    flags: {
      workdir: {
        type: "string",
        shortFlag: "w",
        default: process.env.WORKDIR ?? path.join(os.tmpdir(), "hume-tts"),
      },
      embeddedAudioMode: {
        type: "boolean",
        default: process.env.EMBEDDED_AUDIO_MODE === "true",
      },
      instantMode: {
        type: "boolean",
        default: true,
      },
    },
  },
);

const main = async () => {
  // Extract flags from CLI
  const { workdir, embeddedAudioMode, instantMode } = cli.flags;

  // Set up logging
  const logFile = await fs.open("/tmp/mcp-server-hume.log", "a");

  // Custom log function that logs to both console and file
  const logFn = (...args: any[]) => {
    console.error(...args);
    logFile.write(JSON.stringify(args) + "\n").catch((err) => {
      console.error("Error writing to log file:", err);
    });
  };

  // Register cleanup on exit
  process.on("exit", async () => {
    await logFile.close();
  });

  // Check for API key
  if (!process.env.HUME_API_KEY) {
    logFn("Please set the HUME_API_KEY environment variable.");
    process.exit(1);
  }

  // Create the Hume server with our configuration
  const humeServer = new HumeServer({
    instantMode,
    workdir,
    embeddedAudioMode,
    log: logFn,
    humeApiKey: process.env.HUME_API_KEY,
  });

  // Create and setup the McpServer
  const mcpServer = new McpServer({
    name: "hume",
    version: "0.1.0",
  });

  // Configure the server with Hume tools
  humeServer.setupMcpServer(mcpServer);

  // Connect server to transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logFn(
    `Hume MCP Server running on stdio (workdir: ${workdir}, embeddedAudioMode: ${embeddedAudioMode})`,
  );
};

// If this file is run directly, start the server
main().catch((error) => {
  // Use console.error directly here since the logFn might not be available
  console.error("Fatal error in main():", error);
  process.exit(1);
});
