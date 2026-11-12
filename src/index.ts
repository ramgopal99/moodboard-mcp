#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer, VERSION } from "./server.js";

async function main() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(VERSION);
    return;
  }
  const server = createServer({ config: loadConfig() });
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the MCP protocol; log to stderr only.
  console.error(`moodboard-mcp ${VERSION} running on stdio`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
