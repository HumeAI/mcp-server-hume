import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHumeServer, log, setLogFile } from "./server.js";
import * as fs from "fs/promises";

const main = async () => {
  // Create server instance for the main app
  const server = createHumeServer();

  setLogFile(await fs.open("/tmp/mcp-server-hume.log", "a"));
  if (!process.env.HUME_API_KEY) {
    log("Please set the HUME_API_KEY environment variable.");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Hume MCP Server running on stdio");
};


// If this file is run directly, start the server
main().catch((error) => {
  log("Fatal error in main():", error);
  process.exit(1);
});
