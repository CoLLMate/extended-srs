// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import {
  handleSubmitForReview,
  handleGetReviewHistory,
  handleApproveReview,
} from '../dist/tools/review.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';
import { readReviews, writeReview } from '../dist/io/reviewStorage.js';

const pending = (review_id = 1) =>
  JSON.stringify({ review_id, element_id: 'FR-001', gate_type: 'content', status: 'pending' });

const worker = fileURLToPath(new URL('../dist/io/reviewStorageWorker.js', import.meta.url));

test('review compare-and-replace rejects a stale snapshot and releases its lock', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  t.after(() => fx.cleanup());
  await fx.writeFile('reviews/FR-001/0001.json', pending());
  const [original] = await readReviews(fx.specRoot, 'FR-001');
  await writeReview(fx.specRoot, 'FR-001', { ...original, status: 'approved' }, false, original);
  await assert.rejects(
    writeReview(fx.specRoot, 'FR-001', { ...original, status: 'rejected' }, false, original),
    /Concurrent review update conflict/,
  );
  assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0001.json')).status, 'approved');
  assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), ['0001.json']);
});

for (const stale of [false, true]) {
  test(`review update ${stale ? 'recovers an abandoned' : 'rejects an active'} cross-process lock`, async (t) => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    t.after(() => fx.cleanup());
    await fx.writeFile('reviews/FR-001/0001.json', pending());
    const lock = path.join(fx.specRoot, 'reviews/FR-001/.0001.json.lock');
    await fs.mkdir(lock);
    if (stale) {
      const past = new Date(Date.now() - 120000);
      await fs.utimes(lock, past, past);
    }
    const result = await handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 });
    assert.equal(result.success, stale);
    if (stale) {
      assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0001.json')).status, 'approved');
      await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
    } else {
      assert.match(result.error, /Concurrent review update conflict/);
      assert.equal(await fx.readFile('reviews/FR-001/0001.json'), pending());
      assert.ok((await fs.stat(lock)).isDirectory());
    }
  });
}

test('a review lock cannot follow a symlink outside the SRS root', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  t.after(() => fx.cleanup());
  await fx.writeFile('reviews/FR-001/0001.json', pending());
  const outside = path.join(fx.root, 'outside-lock');
  await fs.mkdir(outside);
  const before = await fs.stat(outside);
  await fs.symlink(outside, path.join(fx.specRoot, 'reviews/FR-001/.0001.json.lock'), 'dir');
  await assert.rejects(
    handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 }),
    /Unsafe review path.*symbolic links/,
  );
  assert.equal((await fs.stat(outside)).mtimeMs, before.mtimeMs);
  assert.equal(await fx.readFile('reviews/FR-001/0001.json'), pending());
});

test('review auto-commit includes only its own record, including literal metacharacters in IDs', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  t.after(() => fx.cleanup());
  const previous = process.env.EXTSRS_AUTO_COMMIT;
  process.env.EXTSRS_AUTO_COMMIT = 'true';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.EXTSRS_AUTO_COMMIT;
    } else {
      process.env.EXTSRS_AUTO_COMMIT = previous;
    }
  });
  await fx.writeFile('reviews/FR-[1]/0001.json', pending().replace('FR-001', 'FR-[1]'));
  await fx.writeFile('reviews/FR-1/0001.json', pending());
  const prefix = path.relative(fx.root, fx.specRoot);
  fx.git(['add', `${prefix}/reviews/FR-1/0001.json`]);
  // Persisted legacy records can have an arbitrary single-component element ID.
  const result = await handleApproveReview(fx.specRoot, { element_id: 'FR-[1]', review_id: 1 });
  assert.equal(result.success, true);
  assert.deepEqual(
    fx.git(['show', '--format=', '--name-only', result.commit_sha]).trim().split('\n'),
    [`${prefix}/reviews/FR-[1]/0001.json`],
  );
  assert.equal(
    fx.git(['diff', '--cached', '--name-only']).trim(),
    `${prefix}/reviews/FR-1/0001.json`,
  );
});

// Preload only the storage child. The hooks replace real directory entries at
// the syscall boundary and then run the real OS operation, not a mocked result.
async function injectWorker(t, fx, body, extra = {}, beforeSpawn) {
  const config = {
    root: await fs.realpath(fx.specRoot),
    outside: path.join(fx.root, 'outside'),
    marker: path.join(fx.root, 'injected'),
    ...extra,
  };
  const preload = path.join(fx.root, 'storage-hook.cjs');
  await fs.writeFile(
    preload,
    `
    const fs = require('node:fs');
    const config = ${JSON.stringify(config)};
    const mark = fs.writeFileSync.bind(fs, config.marker, 'injected');
    ${body}
    require('node:module').syncBuiltinESMExports();
  `,
  );
  const original = childProcess.execFileSync;
  t.mock.method(childProcess, 'execFileSync', (executable, args, options) => {
    if (args[0] === worker) {
      if (beforeSpawn) {
        beforeSpawn(config);
      }
      return original(executable, ['--require', preload, ...args], options);
    }
    return original(executable, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return config;
}

test('new review allocation retries an occupied id without changing the winning record', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const original = JSON.stringify({
      review_id: 1,
      element_id: 'FR-001',
      gate_type: 'content',
      status: 'pending',
      summary: 'first',
    });
    const config = await injectWorker(
      t,
      fx,
      `
      const link = fs.linkSync;
      fs.linkSync = (from, to, ...args) => {
        if (!fs.existsSync(config.marker)) {
          fs.writeFileSync(to, config.original);
          mark();
        }
        return link(from, to, ...args);
      };
    `,
      { original },
    );
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
      summary: 'second',
    });
    assert.equal(result.success, true);
    assert.equal(result.review_id, 2);
    assert.equal(await fs.readFile(config.marker, 'utf8'), 'injected');
    assert.equal(await fx.readFile('reviews/FR-001/0001.json'), original);
    assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0002.json')).summary, 'second');
    assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), [
      '0001.json',
      '0002.json',
    ]);
  } finally {
    await fx.cleanup();
  }
});

test('new review allocation propagates publication errors and cleans up incomplete records', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const head = fx.git(['rev-parse', 'HEAD']).trim();
    await injectWorker(
      t,
      fx,
      `fs.linkSync = () => { throw Object.assign(new Error('fixture permission failure'), { code: 'EACCES' }); };`,
    );
    await assert.rejects(
      handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
      { code: 'EACCES' },
    );
    assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), []);
    assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
  } finally {
    await fx.cleanup();
  }
});

test('new review allocation rejects exhausted numeric ids without overwriting history', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const original = pending(Number.MAX_SAFE_INTEGER);
    await fx.writeFile('reviews/FR-001/0001.json', original);
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /Invalid review id/);
    assert.equal(await fx.readFile('reviews/FR-001/0001.json'), original);
    assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), ['0001.json']);
  } finally {
    await fx.cleanup();
  }
});

test('a collision on the last safe review id fails in storage without overwriting the winner', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending(Number.MAX_SAFE_INTEGER - 1));
    const winner = pending(Number.MAX_SAFE_INTEGER);
    await injectWorker(
      t,
      fx,
      `
      const link = fs.linkSync;
      fs.linkSync = (from, to, ...args) => {
        fs.writeFileSync(to, config.winner);
        return link(from, to, ...args);
      };
    `,
      { winner },
    );
    await assert.rejects(
      handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
      /Invalid review id/,
    );
    assert.equal(await fx.readFile(`reviews/FR-001/${Number.MAX_SAFE_INTEGER}.json`), winner);
    assert.equal((await fs.readdir(`${fx.specRoot}/reviews/FR-001`)).length, 2);
  } finally {
    await fx.cleanup();
  }
});

test('review reads refuse a file symlink installed immediately before open', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending());
    await fx.writeOutsideSpec('outside.json', pending());
    const outside = path.join(fx.root, 'outside.json');
    const config = await injectWorker(
      t,
      fx,
      `
      const open = fs.openSync;
      fs.openSync = (name, ...args) => {
        if (name === '0001.json') {
          fs.unlinkSync(name);
          fs.symlinkSync(config.target, name);
          mark();
        }
        return open(name, ...args);
      };
    `,
      { target: outside },
    );
    await assert.rejects(handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }), {
      code: 'ELOOP',
    });
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.equal(await fs.readFile(outside, 'utf-8'), pending());
  } finally {
    await fx.cleanup();
  }
});

test('review writes refuse a file symlink installed while preparing the replacement', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeOutsideSpec('outside.json', 'unchanged');
    const outside = path.join(fx.root, 'outside.json');
    const head = fx.git(['rev-parse', 'HEAD']).trim();
    const config = await injectWorker(
      t,
      fx,
      `
      const write = fs.writeFileSync;
      fs.writeFileSync = (...args) => {
        fs.symlinkSync(config.target, '0001.json');
        mark();
        return write(...args);
      };
    `,
      { target: outside },
    );
    await assert.rejects(
      handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
      /Unsafe review path.*symbolic link/,
    );
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.equal(await fs.readFile(outside, 'utf-8'), 'unchanged');
    assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
    assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), ['0001.json']);
  } finally {
    await fx.cleanup();
  }
});

for (const component of ['reviews', 'FR-001']) {
  for (const operation of ['read', 'write']) {
    test(`review ${operation} refuses a symlink replacing ${component} immediately before directory open`, async (t) => {
      const fx = await createSRSFixture({ files: sampleSRSFiles });
      try {
        if (operation === 'read') {
          await fx.writeFile('reviews/FR-001/0001.json', pending());
        }
        await fs.mkdir(path.join(fx.root, 'outside'));
        const config = await injectWorker(
          t,
          fx,
          `
          const open = fs.openSync;
          fs.openSync = (name, ...args) => {
            if (name === config.component) {
              fs.renameSync(name, name + '-original');
              fs.symlinkSync(config.outside, name, 'dir');
              mark();
            }
            return open(name, ...args);
          };
        `,
          { component },
        );
        const action =
          operation === 'read'
            ? handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' })
            : handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' });
        await assert.rejects(action, (error) => ['ELOOP', 'ENOTDIR'].includes(error.code));
        assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
        assert.deepEqual(await fs.readdir(config.outside), []);
      } finally {
        await fx.cleanup();
      }
    });
  }
}

for (const component of ['reviews', 'FR-001']) {
  for (const operation of ['read', 'write']) {
    test(`review ${operation} rejects replacement of ${component} between open and chdir`, async (t) => {
      const fx = await createSRSFixture({ files: sampleSRSFiles });
      try {
        if (operation === 'read') {
          await fx.writeFile('reviews/FR-001/0001.json', pending());
        }
        const outside = path.join(fx.root, 'outside');
        await fs.mkdir(outside);
        const config = await injectWorker(
          t,
          fx,
          `
          const chdir = process.chdir;
          process.chdir = (name) => {
            if (name === config.component) {
              fs.renameSync(name, name + '-original');
              fs.symlinkSync(config.outside, name, 'dir');
              mark();
            }
            return chdir(name);
          };
        `,
          { component },
        );
        const action =
          operation === 'read'
            ? handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' })
            : handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' });
        await assert.rejects(action, /Unsafe review path.*directory changed/);
        assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
        assert.deepEqual(await fs.readdir(outside), []);
      } finally {
        await fx.cleanup();
      }
    });
  }
}

for (const component of ['reviews', 'FR-001']) {
  for (const operation of ['read', 'write']) {
    test(`review ${operation} stays in the pinned directory when ${component} is replaced immediately before I/O`, async (t) => {
      const fx = await createSRSFixture({ files: sampleSRSFiles });
      const previous = process.env.EXTSRS_AUTO_COMMIT;
      process.env.EXTSRS_AUTO_COMMIT = 'false';
      try {
        await fx.writeFile('reviews/FR-001/0001.json', pending());
        const outside = path.join(fx.root, 'outside');
        await fs.mkdir(outside);
        const replacementFile = component === 'reviews' ? 'FR-001/0001.json' : '0001.json';
        await fs.mkdir(path.dirname(path.join(outside, replacementFile)), { recursive: true });
        await fs.writeFile(
          path.join(outside, replacementFile),
          JSON.stringify({ review_id: 99, status: 'rejected' }),
        );
        const config = await injectWorker(
          t,
          fx,
          `
          const method = config.operation === 'read' ? 'readFileSync' : 'writeFileSync';
          const original = fs[method];
          fs[method] = (fd, ...args) => {
            if (typeof fd === 'number' && fd > 3 && !fs.existsSync(config.marker)) {
              const target = config.root + '/reviews' + (config.component === 'FR-001' ? '/FR-001' : '');
              fs.renameSync(target, target + '-original');
              fs.symlinkSync(config.outside, target, 'dir');
              mark();
            }
            return original(fd, ...args);
          };
        `,
          { component, operation },
        );
        if (operation === 'read') {
          const result = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
          assert.deepEqual(
            result.reviews.map((r) => r.review_id),
            [1],
          );
        } else {
          const result = await handleApproveReview(fx.specRoot, {
            element_id: 'FR-001',
            review_id: 1,
          });
          assert.equal(result.success, true);
          const originalFile =
            component === 'reviews'
              ? 'reviews-original/FR-001/0001.json'
              : 'reviews/FR-001-original/0001.json';
          assert.equal(JSON.parse(await fx.readFile(originalFile)).status, 'approved');
        }
        assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
        assert.equal(
          JSON.parse(await fs.readFile(path.join(outside, replacementFile), 'utf-8')).review_id,
          99,
        );
        assert.deepEqual(await fs.readdir(path.dirname(path.join(outside, replacementFile))), [
          '0001.json',
        ]);
      } finally {
        if (previous === undefined) {
          delete process.env.EXTSRS_AUTO_COMMIT;
        } else {
          process.env.EXTSRS_AUTO_COMMIT = previous;
        }
        await fx.cleanup();
      }
    });
  }
}

for (const method of [
  'mkdirSync',
  'lstatSync',
  'readdirSync',
  'readFileSync',
  'writeFileSync',
  'renameSync',
]) {
  test(`review storage propagates ${method} failures without reporting success`, async (t) => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      await fx.writeFile('reviews/FR-001/0001.json', pending());
      const head = fx.git(['rev-parse', 'HEAD']).trim();
      await injectWorker(
        t,
        fx,
        `
        const method = config.method;
        const original = fs[method];
        fs[method] = (name, ...args) => {
          if (method !== 'readFileSync' || (typeof name === 'number' && name > 3)) {
            throw Object.assign(new Error('fixture permission failure'), { code: 'EACCES' });
          }
          return original(name, ...args);
        };
      `,
        { method },
      );
      const action = ['mkdirSync', 'writeFileSync', 'renameSync'].includes(method)
        ? handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 })
        : handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
      await assert.rejects(action, { code: 'EACCES', message: 'fixture permission failure' });
      assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
      assert.equal(await fx.readFile('reviews/FR-001/0001.json'), pending());
      assert.deepEqual(await fs.readdir(path.join(fx.specRoot, 'reviews/FR-001')), ['0001.json']);
    } finally {
      await fx.cleanup();
    }
  });
}

test('review storage refuses an SRS root replaced by a symlink before it is pinned', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const root = await fs.realpath(fx.specRoot);
    const outside = path.join(fx.root, 'outside');
    await fs.mkdir(outside);
    const open = fs.open.bind(fs);
    let replaced = false;
    t.mock.method(fs, 'open', async (name, ...args) => {
      if (name === root) {
        await fs.rename(root, root + '-original');
        await fs.symlink(outside, root, 'dir');
        replaced = true;
      }
      return open(name, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    await assert.rejects(handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }), (error) =>
      ['ELOOP', 'ENOTDIR'].includes(error.code),
    );
    assert.equal(replaced, true);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fx.cleanup();
  }
});

test('review storage rejects an SRS root replaced between pinning it and spawning the worker', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fs.mkdir(path.join(fx.root, 'outside'));
    const config = await injectWorker(t, fx, '', {}, (cfg) => {
      fsSync.renameSync(cfg.root, cfg.root + '-original');
      fsSync.symlinkSync(cfg.outside, cfg.root, 'dir');
      fsSync.writeFileSync(cfg.marker, 'injected');
    });
    await assert.rejects(
      handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }),
      /Unsafe review path.*directory changed/,
    );
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.deepEqual(await fs.readdir(config.outside), []);
  } finally {
    await fx.cleanup();
  }
});

test('review directory creation stays under the pinned reviews directory during a replacement', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  const previous = process.env.EXTSRS_AUTO_COMMIT;
  process.env.EXTSRS_AUTO_COMMIT = 'false';
  try {
    await fs.mkdir(path.join(fx.root, 'outside'));
    const config = await injectWorker(
      t,
      fx,
      `
      const mkdir = fs.mkdirSync;
      fs.mkdirSync = (name, ...args) => {
        if (name === 'FR-001') {
          fs.renameSync(config.root + '/reviews', config.root + '/reviews-original');
          fs.symlinkSync(config.outside, config.root + '/reviews', 'dir');
          mark();
        }
        return mkdir(name, ...args);
      };
    `,
    );
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(result.success, true);
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.deepEqual(await fs.readdir(config.outside), []);
    assert.equal(
      JSON.parse(await fx.readFile('reviews-original/FR-001/0001.json')).status,
      'pending',
    );
  } finally {
    if (previous === undefined) {
      delete process.env.EXTSRS_AUTO_COMMIT;
    } else {
      process.env.EXTSRS_AUTO_COMMIT = previous;
    }
    await fx.cleanup();
  }
});

test('atomic review replacement does not follow a file symlink installed immediately before rename', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending());
    await fx.writeOutsideSpec('outside.json', 'unchanged');
    const target = path.join(fx.root, 'outside.json');
    const config = await injectWorker(
      t,
      fx,
      `
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (to === '0001.json') {
          fs.unlinkSync(to);
          fs.symlinkSync(config.target, to);
          mark();
        }
        return rename(from, to);
      };
    `,
      { target },
    );
    const result = await handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 });
    assert.equal(result.success, true);
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.equal(await fs.readFile(target, 'utf-8'), 'unchanged');
    assert.equal(
      (await fs.lstat(path.join(fx.specRoot, 'reviews/FR-001/0001.json'))).isSymbolicLink(),
      false,
    );
    assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0001.json')).status, 'approved');
  } finally {
    await fx.cleanup();
  }
});

test('review reads reject a non-file replacing a record immediately before open', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending());
    const config = await injectWorker(
      t,
      fx,
      `
      const open = fs.openSync;
      fs.openSync = (name, ...args) => {
        if (name === '0001.json') {
          fs.unlinkSync(name);
          fs.mkdirSync(name);
          mark();
        }
        return open(name, ...args);
      };
    `,
    );
    await assert.rejects(
      handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }),
      /Unsafe review path.*expected a file/,
    );
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
  } finally {
    await fx.cleanup();
  }
});

test('review writes reject a directory symlink installed after reading history', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending());
    await fs.mkdir(path.join(fx.root, 'outside'));
    const config = await injectWorker(
      t,
      fx,
      `
      const readdir = fs.readdirSync;
      fs.readdirSync = (...args) => {
        const entries = readdir(...args);
        if (!fs.existsSync(config.marker)) {
          fs.renameSync(config.root + '/reviews', config.root + '/reviews-original');
          fs.symlinkSync(config.outside, config.root + '/reviews', 'dir');
          mark();
        }
        return entries;
      };
    `,
    );
    await assert.rejects(
      handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
      /Unsafe review path.*symbolic link/,
    );
    assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
    assert.deepEqual(await fs.readdir(config.outside), []);
  } finally {
    await fx.cleanup();
  }
});

for (const replacement of ['symlink', 'missing']) {
  test(`review commit does not stage outside files when reviews becomes ${replacement} during storage`, async (t) => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    const previous = process.env.EXTSRS_AUTO_COMMIT;
    process.env.EXTSRS_AUTO_COMMIT = 'true';
    try {
      await fx.writeFile('reviews/FR-001/0001.json', pending());
      await fx.writeOutsideSpec('outside/private.txt', 'keep outside the commit');
      const head = fx.git(['rev-parse', 'HEAD']).trim();
      const config = await injectWorker(
        t,
        fx,
        `
        const write = fs.writeFileSync;
        fs.writeFileSync = (...args) => {
          fs.renameSync(config.root + '/reviews', config.root + '/reviews-original');
          if (config.replacement === 'symlink') fs.symlinkSync(config.outside, config.root + '/reviews', 'dir');
          mark();
          return write(...args);
        };
      `,
        { replacement },
      );
      const result = await handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 });
      assert.equal(result.success, true);
      assert.equal(result.commit_sha, null);
      assert.equal(await fs.readFile(config.marker, 'utf-8'), 'injected');
      assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
      assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
      assert.equal(
        await fs.readFile(path.join(config.outside, 'private.txt'), 'utf-8'),
        'keep outside the commit',
      );
      assert.equal(
        JSON.parse(await fx.readFile('reviews-original/FR-001/0001.json')).status,
        'approved',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.EXTSRS_AUTO_COMMIT;
      } else {
        process.env.EXTSRS_AUTO_COMMIT = previous;
      }
      await fx.cleanup();
    }
  });
}

for (const location of ['reviews', 'reviews/FR-001', 'reviews/FR-001/0001.json']) {
  test(`review storage rejects an unexpected filesystem type at ${location}`, async () => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      if (location.endsWith('.json')) {
        await fs.mkdir(path.join(fx.specRoot, location), { recursive: true });
      } else {
        await fx.writeFile(location, 'not a directory');
      }
      await assert.rejects(
        handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }),
        /Unsafe review path.*expected a/,
      );
    } finally {
      await fx.cleanup();
    }
  });
}

test('review history skips malformed JSON and submission allocates after the highest existing id', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await fx.writeFile('reviews/FR-001/0001.json', pending(1));
    await fx.writeFile('reviews/FR-001/0003.json', pending(3));
    await fx.writeFile('reviews/FR-001/broken.json', '{');
    await fx.writeFile('reviews/FR-001/notes.txt', 'not a review');
    const history = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.deepEqual(
      history.reviews.map((r) => r.review_id),
      [1, 3],
    );
    const submitted = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(submitted.success, true);
    assert.equal(submitted.review_id, 4);
    assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0004.json')).status, 'pending');
  } finally {
    await fx.cleanup();
  }
});

test('review writes reject a filename derived from an unsafe stored review id', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const unsafeId = '../../../outside';
    await fx.writeFile('reviews/FR-001/0001.json', pending(unsafeId));
    await fx.writeOutsideSpec('outside.json', 'unchanged');
    await assert.rejects(
      handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: unsafeId }),
      /Unsafe review path.*invalid record filename/,
    );
    assert.equal(await fs.readFile(path.join(fx.root, 'outside.json'), 'utf-8'), 'unchanged');
    assert.equal(await fx.readFile('reviews/FR-001/0001.json'), pending(unsafeId));
  } finally {
    await fx.cleanup();
  }
});
