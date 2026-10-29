// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareStatusChange, applyStatusChange } from '../dist/tools/lifecycle.js';
import { createSRSFixture } from './fixture.js';
import { withMCP, document, requirement, manifest } from './mcpClient.js';

const source = document({
  manifest: manifest(),
  'functional-requirements': {
    requirements: [requirement('FR-FIRST'), requirement('FR-SECOND')],
  },
});

async function preload(fx, body, run) {
  const filename = path.join(fx.root, 'concurrency-hook.cjs');
  await fs.writeFile(filename, body);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${previous ?? ''} --require=${filename}`;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = previous;
    }
  }
}

async function until(check) {
  const deadline = Date.now() + 6000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'I/O boundary was not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('two MCP processes cannot both succeed with conflicting document snapshots', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    const barrier = path.join(fx.root, 'barrier');
    const release = path.join(barrier, 'release');
    await fs.mkdir(barrier);
    await preload(
      fx,
      `
      if (process.argv[1]?.endsWith('/documentStorageWorker.js')) {
        const fs = require('node:fs');
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          if (to === 'srs.md') {
            fs.writeFileSync(${JSON.stringify(barrier)} + '/' + process.pid + '.ready', 'ready');
            const flag = new Int32Array(new SharedArrayBuffer(4));
            const deadline = Date.now() + 8000;
            while (!fs.existsSync(${JSON.stringify(release)})) {
              if (Date.now() > deadline) throw new Error('Fixture barrier timed out');
              Atomics.wait(flag, 0, 0, 10);
            }
          }
          return rename(from, to);
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(fx, (first) =>
          withMCP(fx, async (second) => {
            const ready = async () =>
              (await fs.readdir(barrier)).filter((name) => name.endsWith('.ready')).length;
            const firstCall = first('set_element_status', {
              element_id: 'FR-FIRST',
              new_status: 'approved',
            });
            let secondCall;
            try {
              await until(async () => (await ready()) === 1);
              let secondFinished = false;
              secondCall = second('set_element_status', {
                element_id: 'FR-SECOND',
                new_status: 'approved',
              }).then((result) => {
                secondFinished = true;
                return result;
              });
              // A correct lock rejects the second update while the first owns the
              // rename boundary. Without a lock both workers reach that boundary.
              await until(async () => secondFinished || (await ready()) === 2);
            } finally {
              await fs.writeFile(release, 'go');
            }
            const [one, two] = await Promise.all([firstCall, secondCall]);
            assert.equal(one.success, true, JSON.stringify(one));
            assert.equal(two.success, false, JSON.stringify(two));
            assert.match(two.error, /concurrent|conflict|lock/i);
            assert.equal(
              (await first('get_project_state')).elements.filter((e) => e.status === 'approved')
                .length,
              1,
            );
            const retried = await second('set_element_status', {
              element_id: 'FR-SECOND',
              new_status: 'approved',
            });
            assert.equal(retried.success, true, JSON.stringify(retried));
            assert.equal(
              (await first('get_project_state')).elements.filter((e) => e.status === 'approved')
                .length,
              2,
            );
            assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
          }),
        ),
    );
  } finally {
    await fx.cleanup();
  }
});

test('an in-place edit while writing the replacement is retained and reported as a conflict', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    await preload(
      fx,
      `
      if (process.argv[1]?.endsWith('/documentStorageWorker.js')) {
        const fs = require('node:fs');
        const write = fs.writeFileSync;
        let edited = false;
        fs.writeFileSync = (...args) => {
          if (!edited && typeof args[0] === 'number' && args[0] > 3) {
            edited = true;
            const inode = fs.statSync('srs.md').ino;
            write('srs.md', fs.readFileSync('srs.md', 'utf8') + '\\nHUMAN_EDIT\\n');
            if (fs.statSync('srs.md').ino !== inode) throw new Error('Fixture changed inode');
          }
          return write(...args);
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(fx, async (call) => {
          const result = await call('set_element_status', {
            element_id: 'FR-FIRST',
            new_status: 'approved',
          });
          assert.equal(result.success, false, JSON.stringify(result));
          assert.match(result.error, /concurrent|conflict/i);
          assert.equal(await fx.readFile('srs.md'), `${source}\nHUMAN_EDIT\n`);
          assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
        }),
    );
  } finally {
    await fx.cleanup();
  }
});

for (const replacement of ['symlink', 'directory']) {
  test(`a prepared change cannot write to a replacement root (${replacement})`, async () => {
    const fx = await createSRSFixture({ files: { 'srs.md': source } });
    try {
      const prepared = await prepareStatusChange(fx.specRoot, {
        element_id: 'FR-FIRST',
        new_status: 'approved',
      });
      const original = fx.specRoot + '-original';
      const outside = path.join(fx.root, 'outside');
      await fx.writeOutsideSpec('outside/srs.md', source);
      await fs.rename(fx.specRoot, original);
      if (replacement === 'symlink') {
        await fs.symlink(outside, fx.specRoot, 'dir');
      } else {
        await fs.rename(outside, fx.specRoot);
      }
      const head = fx.git(['rev-parse', 'HEAD']);
      await assert.rejects(
        applyStatusChange(prepared),
        /directory changed|root.*changed|ELOOP|ENOTDIR/i,
      );
      assert.equal(prepared.root.directory.fd, -1, 'failed saves release the root descriptor');
      assert.equal(await fs.readFile(path.join(original, 'srs.md'), 'utf8'), source);
      assert.equal(await fx.readFile('srs.md'), source);
      assert.equal(fx.git(['rev-parse', 'HEAD']), head);
      assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
    } finally {
      await fx.cleanup();
    }
  });
}

test('a prepared change keeps the selected root when its original alias is retargeted', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  t.after(() => fx.cleanup());
  await fx.writeOutsideSpec('outside/srs.md', source);
  const alias = path.join(fx.root, 'alias');
  const outside = path.join(fx.root, 'outside');
  await fs.symlink(fx.specRoot, alias, 'dir');
  const prepared = await prepareStatusChange(alias, {
    element_id: 'FR-FIRST',
    new_status: 'approved',
  });
  t.after(() => prepared.root.close());
  await fs.unlink(alias);
  await fs.symlink(outside, alias, 'dir');
  const result = await applyStatusChange(prepared);
  assert.equal(result.success, true);
  assert.equal(prepared.root.directory.fd, -1, 'successful saves release the root descriptor');
  assert.match(await fx.readFile('srs.md'), /"status": "approved"/);
  assert.equal(await fs.readFile(path.join(outside, 'srs.md'), 'utf8'), source);
});

test('MCP rejects a root swapped after preparation, without updating or committing outside documents', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    await fx.writeOutsideSpec('outside/srs.md', source);
    const root = await fs.realpath(fx.specRoot);
    const outside = path.join(await fs.realpath(fx.root), 'outside');
    const marker = path.join(fx.root, 'swapped');
    const head = fx.git(['rev-parse', 'HEAD']);
    await preload(
      fx,
      `
      if (process.argv[1]?.endsWith('/dist/index.js')) {
        const fs = require('node:fs');
        const cp = require('node:child_process');
        const exec = cp.execFileSync;
        let swapped = false;
        cp.execFileSync = (file, args, options) => {
          const result = exec(file, args, options);
          if (!swapped && args[0]?.endsWith('/reviewStorageWorker.js')) {
            swapped = true;
            fs.renameSync(${JSON.stringify(root)}, ${JSON.stringify(root + '-original')});
            fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(root)}, 'dir');
            fs.writeFileSync(${JSON.stringify(marker)}, 'swapped');
          }
          return result;
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(
          fx,
          async (call) => {
            const result = await call('set_element_status', {
              element_id: 'FR-FIRST',
              new_status: 'approved',
            });
            assert.equal(await fs.readFile(marker, 'utf8'), 'swapped');
            assert.equal(result.success, false, JSON.stringify(result));
            assert.equal(await fs.readFile(path.join(outside, 'srs.md'), 'utf8'), source);
            assert.equal(
              await fs.readFile(path.join(root + '-original', 'srs.md'), 'utf8'),
              source,
            );
            assert.equal(fx.git(['rev-parse', 'HEAD']), head);
            assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
          },
          true,
        ),
    );
  } finally {
    await fx.cleanup();
  }
});

test('a root swapped during a pinned write cannot redirect the following Git commit', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    await fx.writeOutsideSpec('outside/srs.md', source);
    const root = await fs.realpath(fx.specRoot);
    const outside = path.join(await fs.realpath(fx.root), 'outside');
    const head = fx.git(['rev-parse', 'HEAD']);
    await preload(
      fx,
      `
      if (process.argv[1]?.endsWith('/documentStorageWorker.js')) {
        const fs = require('node:fs');
        const write = fs.writeFileSync;
        let swapped = false;
        fs.writeFileSync = (...args) => {
          if (!swapped && typeof args[0] === 'number' && args[0] > 3) {
            swapped = true;
            fs.renameSync(${JSON.stringify(root)}, ${JSON.stringify(root + '-original')});
            fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(root)}, 'dir');
          }
          return write(...args);
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(
          fx,
          async (call) => {
            const result = await call('set_element_status', {
              element_id: 'FR-FIRST',
              new_status: 'approved',
            });
            assert.equal(result.success, true, JSON.stringify(result));
            assert.equal(result.commit_sha, null);
            assert.equal(await fs.readFile(path.join(outside, 'srs.md'), 'utf8'), source);
            assert.match(
              await fs.readFile(path.join(root + '-original', 'srs.md'), 'utf8'),
              /"status": "approved"/,
            );
            assert.equal(fx.git(['rev-parse', 'HEAD']), head);
            assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
          },
          true,
        ),
    );
  } finally {
    await fx.cleanup();
  }
});

test('review submission pins the root across document reads and review writes', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    await fx.writeOutsideSpec('outside/srs.md', source);
    const root = await fs.realpath(fx.specRoot);
    const outside = path.join(await fs.realpath(fx.root), 'outside');
    const marker = path.join(fx.root, 'swapped');
    await preload(
      fx,
      `
      if (process.argv[1]?.endsWith('/dist/index.js')) {
        const fs = require('node:fs');
        const cp = require('node:child_process');
        const exec = cp.execFileSync;
        let swapped = false;
        cp.execFileSync = (file, args, options) => {
          const result = exec(file, args, options);
          if (!swapped && args[0]?.endsWith('/documentStorageWorker.js')) {
            swapped = true;
            fs.renameSync(${JSON.stringify(root)}, ${JSON.stringify(root + '-original')});
            fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(root)}, 'dir');
            fs.writeFileSync(${JSON.stringify(marker)}, 'swapped');
          }
          return result;
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(fx, async (call) => {
          const result = await call('submit_for_review', {
            element_id: 'FR-FIRST',
            gate_type: 'content',
          });
          assert.equal(await fs.readFile(marker, 'utf8'), 'swapped');
          assert.equal(result.success, false, JSON.stringify(result));
          assert.deepEqual(await fs.readdir(outside), ['srs.md']);
          assert.deepEqual(await fs.readdir(root + '-original'), ['srs.md']);
        }),
    );
  } finally {
    await fx.cleanup();
  }
});
