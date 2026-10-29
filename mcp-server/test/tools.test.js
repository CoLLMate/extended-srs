// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Contract of the official MCP server over stdio: the tool list (names,
 * descriptions, input schemas) must match test/mcp-tools.json, and the
 * server must validate an SRS root. After an intentional interface change,
 * run `UPDATE_SNAPSHOT=1 npm test` to rewrite the snapshot and review the diff.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

const snapshotPath = new URL('./mcp-tools.json', import.meta.url);
const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const coveragePreload = fileURLToPath(new URL('./coverage-flush.cjs', import.meta.url));

const minimalProject = {
  'srs.md': [
    '# Minimal project',
    '',
    '<!--@srs',
    '# placeholder',
    '@srs-->',
    '',
    '<!--@srs',
    'manifest:',
    '  format: extended-srs/v1',
    '  project_name: Minimal project',
    '@srs-->',
    '',
  ].join('\n'),
};

async function withServer(fx, run) {
  const client = new Client(
    { name: 'extended-srs-mcp-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...(process.env.NODE_V8_COVERAGE ? ['--require', coveragePreload] : []), serverPath],
    env: {
      ...process.env,
      EXTENDED_SRS_ROOT: fx.specRoot,
      EXTSRS_AUTO_COMMIT: 'false',
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

test('stdio server: tool definitions match the snapshot and the SRS root validates', async () => {
  const fx = await createSRSFixture({ files: minimalProject });
  try {
    await withServer(fx, async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 13);

      const snapshot = JSON.stringify({ tools }, null, 2) + '\n';
      if (process.env.UPDATE_SNAPSHOT) {
        writeFileSync(snapshotPath, snapshot);
      } else {
        assert.deepEqual(
          JSON.parse(snapshot),
          JSON.parse(readFileSync(snapshotPath, 'utf8')),
          'MCP tools differ from test/mcp-tools.json; run UPDATE_SNAPSHOT=1 npm test and review the diff',
        );
      }

      const result = await client.callTool({
        name: 'validate_extended_srs',
        arguments: { include_files: true },
      });
      assert.ok(!result.isError, JSON.stringify(result));
      const report = JSON.parse(result.content[0].text);
      assert.equal(report.success, true, JSON.stringify(report));
      assert.deepEqual(report.result.errors, []);
      assert.equal(report.result.srsStructure.hasManifest, true);
    });
  } finally {
    await fx.cleanup();
  }
});

test('stdio server: project, lifecycle, review and history tools work together', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await withServer(fx, async (client) => {
      async function call(name, args = {}) {
        const result = await client.callTool({ name, arguments: args });
        assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
        const report = JSON.parse(result.content[0].text);
        assert.equal(report.success, true, `${name}: ${JSON.stringify(report)}`);
        return report;
      }
      await call('get_project_state');
      await call('get_unblocked_elements', { work_type: 'spec' });
      await call('check_consistency', {
        file_path: 'functional-requirements.md',
        element_id: 'FR-001',
      });
      await call('get_status_history', { element_id: 'FR-001' });
      await call('get_change_log', { element_id: 'FR-001' });
      await call('set_element_status', { element_id: 'FR-001', new_status: 'tentative' });
      await call('approve_element', { element_id: 'FR-001' });
      await call('set_element_status', { element_id: 'FR-0010', new_status: 'tentative' });
      await call('reject_element', { element_id: 'FR-0010', reason: 'needs revision' });

      const first = await call('submit_for_review', { element_id: 'FR-001', gate_type: 'content' });
      assert.equal(first.review_id, 1);
      await call('approve_review', { element_id: 'FR-001', review_id: first.review_id });
      const second = await call('submit_for_review', {
        element_id: 'FR-001',
        gate_type: 'content',
      });
      assert.equal(second.review_id, 2);
      await call('reject_review', {
        element_id: 'FR-001',
        review_id: second.review_id,
        reason: 'needs revision',
      });
      const history = await call('get_review_history', { element_id: 'FR-001' });
      assert.deepEqual(
        history.reviews.map((r) => r.status),
        ['approved', 'rejected'],
      );
    });
  } finally {
    await fx.cleanup();
  }
});

test('stdio server: missing required arguments return errors without changing the project', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const before = fx.git(['rev-parse', 'HEAD']);
    await withServer(fx, async (client) => {
      const cases = [
        ['check_consistency', {}, 'file_path is required for check_consistency'],
        ['get_status_history', {}, 'element_id is required'],
        ['get_change_log', {}, 'element_id is required'],
        ['submit_for_review', {}, 'element_id is required'],
        ['submit_for_review', { element_id: 'FR-001' }, 'gate_type is required'],
        ['get_review_history', {}, 'element_id is required'],
        ['approve_review', {}, 'element_id is required'],
        ['approve_review', { element_id: 'FR-001' }, 'review_id is required'],
        ['reject_review', {}, 'element_id is required'],
        ['reject_review', { element_id: 'FR-001' }, 'review_id is required'],
        ['reject_review', { element_id: 'FR-001', review_id: 1 }, 'reason is required'],
        ['set_element_status', {}, 'element_id is required'],
        ['set_element_status', { element_id: 'FR-001' }, 'new_status is required'],
        ['approve_element', {}, 'element_id is required'],
        ['reject_element', {}, 'element_id is required'],
        ['reject_element', { element_id: 'FR-001' }, 'reason is required'],
        ['unknown_tool', {}, 'Unknown tool: unknown_tool'],
      ];
      for (const [name, args, error] of cases) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, `${name}: ${JSON.stringify(args)}`);
        assert.deepEqual(JSON.parse(result.content[0].text), { success: false, error });
      }
    });
    assert.equal(fx.git(['rev-parse', 'HEAD']), before);
    assert.equal(fx.git(['status', '--porcelain']), '');
  } finally {
    await fx.cleanup();
  }
});

test('stdio server: all review tools return an error for a symlinked review directory', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const outside = path.join(fx.root, 'outside');
    const record = JSON.stringify({ review_id: 1, element_id: 'FR-001', status: 'pending' });
    await fs.mkdir(path.join(outside, 'FR-001'), { recursive: true });
    await fs.writeFile(path.join(outside, 'FR-001/0001.json'), record);
    await fs.symlink(outside, path.join(fx.specRoot, 'reviews'), 'dir');
    await withServer(fx, async (client) => {
      for (const [name, args] of [
        ['get_review_history', {}],
        ['submit_for_review', { gate_type: 'content' }],
        ['approve_review', { review_id: 1 }],
        ['reject_review', { review_id: 1, reason: 'no' }],
      ]) {
        const result = await client.callTool({
          name,
          arguments: { element_id: 'FR-001', ...args },
        });
        assert.equal(result.isError, true, JSON.stringify(result));
        const report = JSON.parse(result.content[0].text);
        assert.equal(report.success, false);
        assert.match(report.error, /Unsafe review path.*symbolic link/);
      }
    });
    assert.equal(await fs.readFile(path.join(outside, 'FR-001/0001.json'), 'utf-8'), record);
    assert.deepEqual(await fs.readdir(path.join(outside, 'FR-001')), ['0001.json']);
  } finally {
    await fx.cleanup();
  }
});
