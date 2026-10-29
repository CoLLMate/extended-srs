// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('handler commits work without global Git identity or identity auto-detection', () => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^GIT_(AUTHOR_|COMMITTER_|CONFIG_)/.test(name) || name === 'EMAIL') {
      delete env[name];
    }
  }
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
    EXTSRS_AUTO_COMMIT: 'true',
    AGENT_COMMUNICATION_URL: '',
  });
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { createSRSFixture, sampleSRSFiles } from './test/fixture.js';
    import { handleSetElementStatus } from './dist/tools/lifecycle.js';
    import { handleSubmitForReview } from './dist/tools/review.js';
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      for (const result of [
        await handleSetElementStatus(fx.specRoot, { element_id: 'FR-001', new_status: 'approved' }),
        await handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
      ]) {
        assert.equal(result.success, true);
        assert.ok(result.commit_sha);
        assert.equal(fx.git(['show', '-s', '--format=%an <%ae>', result.commit_sha]).trim(), 'Test Author <test@example.com>');
      }
      console.log('commits verified');
    } finally { await fx.cleanup(); }
  `,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf-8' },
  );
  assert.match(output, /commits verified/);
});
