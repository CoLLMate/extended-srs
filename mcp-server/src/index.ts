#!/usr/bin/env node
// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { tools } from './protocol/tools.js';
import { dispatchTool } from './protocol/dispatch.js';

async function main() {
  const server = new Server(
    { name: 'extended-srs-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchTool(
      process.env.EXTENDED_SRS_ROOT,
      request.params.name,
      request.params.arguments ?? {},
    ),
  );
  await server.connect(new StdioServerTransport());
  console.error('Extended SRS MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
