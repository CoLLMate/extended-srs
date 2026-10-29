// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function withMCPClient(fx, run, autoCommit = false) {
  const client = new Client(
    { name: 'extended-srs-regression', version: '1.0.0' },
    { capabilities: {} },
  );
  const preload = fileURLToPath(new URL('./coverage-flush.cjs', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      ...(process.env.NODE_V8_COVERAGE ? ['--require', preload] : []),
      fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    ],
    env: {
      ...process.env,
      EXTENDED_SRS_ROOT: fx.specRoot,
      EXTSRS_AUTO_COMMIT: String(autoCommit),
      AGENT_COMMUNICATION_URL: '',
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close();
  }
}

export async function withMCP(fx, run, autoCommit = false) {
  return withMCPClient(
    fx,
    (client) =>
      run(async (name, args = {}) => {
        const response = await client.callTool({ name, arguments: args });
        return JSON.parse(response.content[0].text);
      }),
    autoCommit,
  );
}

export function document(data, prose = 'Fixture prose.') {
  return `# Fixture\n\n<!--@srs\n${JSON.stringify(data, null, 2)}\n@srs-->\n\n${prose}\n`;
}

export function requirement(id, status = 'draft', depends_on = []) {
  return {
    req_id: id,
    name: id,
    status,
    priority: 'must',
    depends_on,
    acceptance_criteria: [{ given: ['a fixture'], when: ['checked'], then: ['a result'] }],
  };
}

export function manifest(files = []) {
  return { format: 'extended-srs/v1', project_name: 'Regression fixture', files };
}
