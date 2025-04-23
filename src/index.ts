import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHumeServer, log, setLogFile, setWorkdir, setClaudeDesktopMode } from "./server.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Parse command line arguments
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options: {
    workdir?: string;
    claudeDesktopMode?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workdir" && i + 1 < args.length) {
      options.workdir = args[++i];
    } else if (arg === "--claude-desktop-mode") {
      if (i + 1 < args.length && (args[i + 1] === "true" || args[i + 1] === "false")) {
        options.claudeDesktopMode = args[++i] === "true";
      } else {
        options.claudeDesktopMode = true;
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: bun index.js [options]

Options:
  --workdir <path>           Set the working directory for audio files (default: $WORKDIR or ${path.join(os.tmpdir(), "hume-tts")})
  --claude-desktop-mode      Enable Claude desktop mode (default: $CLAUDE_DESKTOP_MODE or true)
  --help, -h                 Show this help message

Environment variables:
  WORKDIR                   Alternative to --workdir
  CLAUDE_DESKTOP_MODE       Alternative to --claude-desktop-mode (set to 'false' to disable)
  HUME_API_KEY              Required Hume API key
`);
      process.exit(0);
    }
  }

  return options;
};

const main = async () => {
  const options = parseArgs();
  
  // Set workdir from command line or environment variable
  const workdir = options.workdir || process.env.WORKDIR || path.join(os.tmpdir(), "hume-tts");
  setWorkdir(workdir);
  
  // Set Claude desktop mode from command line or environment variable
  const claudeDesktopMode = options.claudeDesktopMode !== undefined 
    ? options.claudeDesktopMode 
    : process.env.CLAUDE_DESKTOP_MODE !== 'false';
  setClaudeDesktopMode(claudeDesktopMode);
  
  const server = createHumeServer();

  setLogFile(await fs.open("/tmp/mcp-server-hume.log", "a"));
  if (!process.env.HUME_API_KEY) {
    log("Please set the HUME_API_KEY environment variable.");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`Hume MCP Server running on stdio (workdir: ${workdir}, claudeDesktopMode: ${claudeDesktopMode})`);
};

// If this file is run directly, start the server
main().catch((error) => {
  log("Fatal error in main():", error);
  process.exit(1);
});
