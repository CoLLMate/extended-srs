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
import { readDocuments, readDocument, replaceDocument } from '../dist/io/documentStorage.js';
import { handleSetElementStatus } from '../dist/tools/lifecycle.js';
import { createSRSFixture } from './fixture.js';
import { document, manifest, requirement } from './mcpClient.js';

const worker = fileURLToPath(new URL('../dist/io/documentStorageWorker.js', import.meta.url));

// These hooks change real directory entries at the I/O boundary. The real
// syscall then decides whether the worker's protections hold.
async function injectWorker(t, fx, body, extra = {}, beforeSpawn) {
  const config = {
    root: await fs.realpath(fx.specRoot),
    outside: path.join(fx.root, 'outside'),
    marker: path.join(fx.root, 'injected'),
    ...extra,
  };
  const preload = path.join(fx.root, 'document-hook.cjs');
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
      if (!config.only || JSON.parse(options.input).operation === config.only) {
        return original(executable, ['--require', preload, ...args], options);
      }
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

test('document storage: nested documents and root aliases work, symlinks and node_modules are excluded', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': 'entry',
      '.hidden/fr.md': 'inside',
      'node_modules/ignored.md': 'ignore',
      '.srs-mutation.lock/ignored.md': 'ignore internal coordination files',
      'plain.txt': 'ignore',
    },
  });
  try {
    await fs.mkdir(path.join(fx.specRoot, 'directory.md'));
    await fs.symlink('missing', path.join(fx.specRoot, 'dangling.md'));
    await fs.symlink('.hidden', path.join(fx.specRoot, 'linked-dir'), 'dir');
    const alias = path.join(fx.root, 'alias');
    await fs.symlink(fx.specRoot, alias, 'dir');
    const snapshot = await readDocuments(alias);
    assert.deepEqual(
      snapshot.documents.map((f) => f.path),
      ['.hidden/fr.md', 'srs.md'],
    );
    for (const file of [
      './.hidden/fr.md',
      path.join(alias, '.hidden/fr.md'),
      path.join(snapshot.root, '.hidden/fr.md'),
    ]) {
      assert.equal((await readDocument(alias, file)).content, 'inside');
    }
    await assert.rejects(readDocument(alias, 'directory.md'), /expected a regular file/);
    for (const file of [
      '',
      '\0',
      '..',
      '../outside.md',
      '.hidden/../../outside.md',
      'nested\\file.md',
    ]) {
      await assert.rejects(readDocument(alias, file), /Unsafe SRS path/);
    }
  } finally {
    await fx.cleanup();
  }
});

for (const operation of ['scan', 'read']) {
  test(`document ${operation}: rejects a file replaced by a symlink just before open`, async (t) => {
    const fx = await createSRSFixture({ files: { 'fr.md': 'inside' } });
    try {
      await fx.writeOutsideSpec('outside.md', 'EXTERNAL');
      const config = await injectWorker(
        t,
        fx,
        `
        const open = fs.openSync;
        fs.openSync = (name, ...args) => {
          if (name === 'fr.md') {
            fs.renameSync(name, name + '.original');
            fs.symlinkSync(config.root + '/../outside.md', name);
            mark();
          }
          return open(name, ...args);
        };
      `,
      );
      await assert.rejects(
        operation === 'scan' ? readDocuments(fx.specRoot) : readDocument(fx.specRoot, 'fr.md'),
        { code: 'ELOOP' },
      );
      assert.equal(await fs.readFile(config.marker, 'utf8'), 'injected');
      assert.equal(await fs.readFile(path.join(fx.root, 'outside.md'), 'utf8'), 'EXTERNAL');
    } finally {
      await fx.cleanup();
    }
  });
}

for (const operation of ['scan', 'read', 'replace']) {
  for (const stage of ['before open', 'before chdir', 'before I/O']) {
    test(`document ${operation}: directory replacement ${stage} cannot redirect I/O`, async (t) => {
      const fx = await createSRSFixture({ files: { 'nested/fr.md': 'inside' } });
      try {
        await fx.writeOutsideSpec('outside/fr.md', 'EXTERNAL');
        const config = await injectWorker(
          t,
          fx,
          `
          const swap = () => {
            fs.renameSync(config.root + '/nested', config.root + '/original');
            fs.symlinkSync(config.outside, config.root + '/nested', 'dir');
            mark();
          };
          if (config.stage === 'before chdir') {
            const chdir = process.chdir;
            process.chdir = name => { if (name === 'nested') swap(); return chdir(name); };
          } else {
            const method = config.stage === 'before open' ? 'openSync'
              : config.operation === 'replace' ? 'writeFileSync' : 'readFileSync';
            const original = fs[method];
            fs[method] = (name, ...args) => {
              if (!fs.existsSync(config.marker) && (name === 'nested' || (typeof name === 'number' && name > 3))) swap();
              return original(name, ...args);
            };
          }
        `,
          { operation, stage },
        );
        let action;
        if (operation === 'scan') {
          action = readDocuments(fx.specRoot);
        } else if (operation === 'read') {
          action = readDocument(fx.specRoot, 'nested/fr.md');
        } else {
          action = replaceDocument(fx.specRoot, 'nested/fr.md', 'inside', 'updated');
        }
        if (stage === 'before I/O') {
          const result = await action;
          if (operation === 'scan') {
            assert.equal(result.documents[0].content, 'inside');
          }
          if (operation === 'read') {
            assert.equal(result.content, 'inside');
          }
          assert.equal(
            await fx.readFile('original/fr.md'),
            operation === 'replace' ? 'updated' : 'inside',
          );
        } else {
          await assert.rejects(
            action,
            (error) =>
              ['ELOOP', 'ENOTDIR'].includes(error.code) || /directory changed/.test(error.message),
          );
        }
        assert.equal(await fs.readFile(config.marker, 'utf8'), 'injected');
        assert.equal(await fs.readFile(path.join(config.outside, 'fr.md'), 'utf8'), 'EXTERNAL');
        assert.deepEqual(await fs.readdir(config.outside), ['fr.md']);
      } finally {
        await fx.cleanup();
      }
    });
  }
}

test('document storage: a replaced root is rejected before the child reads documents', async (t) => {
  const fx = await createSRSFixture({ files: { 'fr.md': 'inside' } });
  try {
    await fx.writeOutsideSpec('outside/fr.md', 'EXTERNAL');
    await injectWorker(t, fx, '', {}, (config) => {
      fsSync.renameSync(config.root, config.root + '-original');
      fsSync.symlinkSync(config.outside, config.root, 'dir');
    });
    await assert.rejects(readDocuments(fx.specRoot), /Unsafe SRS path.*directory changed/);
  } finally {
    await fx.cleanup();
  }
});

for (const stage of ['during write', 'before rename']) {
  test(`document replacement: a destination symlink installed ${stage} never modifies its target`, async (t) => {
    const fx = await createSRSFixture({ files: { 'fr.md': 'inside' } });
    try {
      await fx.writeOutsideSpec('outside.md', 'EXTERNAL');
      const config = await injectWorker(
        t,
        fx,
        `
        const method = config.stage === 'during write' ? 'writeFileSync' : 'renameSync';
        const original = fs[method];
        fs[method] = (...args) => {
          fs.unlinkSync('fr.md');
          fs.symlinkSync(config.root + '/../outside.md', 'fr.md');
          mark();
          return original(...args);
        };
      `,
        { stage },
      );
      const action = replaceDocument(fx.specRoot, 'fr.md', 'inside', 'updated');
      if (stage === 'during write') {
        await assert.rejects(action, /file changed before replacement/);
      } else {
        await action;
        assert.equal(await fx.readFile('fr.md'), 'updated');
      }
      assert.equal(await fs.readFile(config.marker, 'utf8'), 'injected');
      assert.equal(await fs.readFile(path.join(fx.root, 'outside.md'), 'utf8'), 'EXTERNAL');
      assert.deepEqual(await fs.readdir(fx.specRoot), ['fr.md']);
    } finally {
      await fx.cleanup();
    }
  });
}

for (const method of ['readFileSync', 'writeFileSync', 'renameSync']) {
  test(`document replacement: ${method} failure preserves the original and removes the temporary file`, async (t) => {
    const fx = await createSRSFixture({ files: { 'fr.md': 'inside' } });
    try {
      await injectWorker(
        t,
        fx,
        `
        const original = fs[config.method];
        fs[config.method] = (name, ...args) => {
          if (config.method !== 'readFileSync' || name > 3) throw Object.assign(new Error('fixture failure'), { code: 'EACCES' });
          return original(name, ...args);
        };
      `,
        { method },
      );
      await assert.rejects(replaceDocument(fx.specRoot, 'fr.md', 'inside', 'updated'), {
        code: 'EACCES',
      });
      assert.equal(await fx.readFile('fr.md'), 'inside');
      assert.deepEqual(await fs.readdir(fx.specRoot), ['fr.md']);
    } finally {
      await fx.cleanup();
    }
  });
}

test('document replacement: stale snapshots fail without overwriting newer content', async () => {
  const fx = await createSRSFixture({ files: { 'fr.md': 'newer' } });
  try {
    await assert.rejects(
      replaceDocument(fx.specRoot, 'fr.md', 'stale', 'updated'),
      /changed concurrently/,
    );
    assert.equal(await fx.readFile('fr.md'), 'newer');
    assert.deepEqual(await fs.readdir(fx.specRoot), ['fr.md']);
  } finally {
    await fx.cleanup();
  }
});

for (const stale of [false, true]) {
  test(`document replacement ${stale ? 'recovers an abandoned' : 'rejects an active'} lock`, async (t) => {
    const fx = await createSRSFixture({ files: { 'fr.md': 'original' } });
    t.after(() => fx.cleanup());
    const lock = path.join(fx.specRoot, '.fr.md.lock');
    await fs.mkdir(lock);
    if (stale) {
      const past = new Date(Date.now() - 120000);
      await fs.utimes(lock, past, past);
      await replaceDocument(fx.specRoot, 'fr.md', 'original', 'updated');
      assert.equal(await fx.readFile('fr.md'), 'updated');
      assert.deepEqual(await fs.readdir(fx.specRoot), ['fr.md']);
    } else {
      await assert.rejects(
        replaceDocument(fx.specRoot, 'fr.md', 'original', 'updated'),
        /changed concurrently/,
      );
      assert.equal(await fx.readFile('fr.md'), 'original');
      assert.ok((await fs.stat(lock)).isDirectory());
    }
  });
}

test('document replacement cannot follow a lock symlink outside the SRS root', async (t) => {
  const fx = await createSRSFixture({ files: { 'fr.md': 'original' } });
  t.after(() => fx.cleanup());
  const outside = path.join(fx.root, 'outside-lock');
  await fs.mkdir(outside);
  const before = await fs.stat(outside);
  await fs.symlink(outside, path.join(fx.specRoot, '.fr.md.lock'), 'dir');
  await assert.rejects(
    replaceDocument(fx.specRoot, 'fr.md', 'original', 'updated'),
    /Unsafe SRS path.*symbolic links/,
  );
  assert.equal((await fs.stat(outside)).mtimeMs, before.mtimeMs);
  assert.equal(await fx.readFile('fr.md'), 'original');
});

test('document replacement: a hard-linked external file and restrictive permissions are preserved', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'entry' } });
  try {
    const outside = path.join(fx.root, 'outside.md');
    await fs.writeFile(outside, 'original', { mode: 0o600 });
    await fs.link(outside, path.join(fx.specRoot, 'fr.md'));
    await replaceDocument(fx.specRoot, 'fr.md', 'original', 'updated');
    assert.equal(await fs.readFile(outside, 'utf8'), 'original');
    assert.equal(await fx.readFile('fr.md'), 'updated');
    assert.equal((await fs.stat(path.join(fx.specRoot, 'fr.md'))).mode & 0o777, 0o600);
  } finally {
    await fx.cleanup();
  }
});

test('document worker rejects traversal even if an invalid request bypasses the parent wrapper', async () => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'entry' } });
  try {
    await fx.writeOutsideSpec('outside.md', 'EXTERNAL');
    const directory = await fs.open(
      fx.specRoot,
      fsSync.constants.O_RDONLY | fsSync.constants.O_DIRECTORY,
    );
    try {
      for (const file of ['../outside.md', undefined, null, 17]) {
        const output = childProcess.execFileSync(process.execPath, [worker], {
          cwd: fx.specRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe', directory.fd],
          input: JSON.stringify({ operation: 'read', file }),
        });
        assert.match(JSON.parse(output).error.message, /invalid file components/);
        assert.ok(!output.includes('EXTERNAL'));
      }
    } finally {
      await directory.close();
    }
  } finally {
    await fx.cleanup();
  }
});

test('lifecycle commit: a directory replaced during storage cannot stage external files', async (t) => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({ manifest: manifest(['nested/fr.md']) }),
      'nested/fr.md': document({
        'functional-requirements': { requirements: [requirement('FR-001')] },
      }),
    },
  });
  const previous = process.env.EXTSRS_AUTO_COMMIT;
  process.env.EXTSRS_AUTO_COMMIT = 'true';
  try {
    await fx.writeOutsideSpec('outside/fr.md', 'EXTERNAL');
    const head = fx.git(['rev-parse', 'HEAD']).trim();
    await injectWorker(
      t,
      fx,
      `
      const write = fs.writeFileSync;
      fs.writeFileSync = (...args) => {
        fs.renameSync(config.root + '/nested', config.root + '/original');
        fs.symlinkSync(config.outside, config.root + '/nested', 'dir');
        return write(...args);
      };
    `,
      { only: 'replace' },
    );
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'approved',
    });
    assert.equal(result.success, true);
    assert.equal(result.commit_sha, null);
    assert.equal(await fs.readFile(path.join(fx.root, 'outside/fr.md'), 'utf8'), 'EXTERNAL');
    assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
    assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
  } finally {
    if (previous === undefined) {
      delete process.env.EXTSRS_AUTO_COMMIT;
    } else {
      process.env.EXTSRS_AUTO_COMMIT = previous;
    }
    await fx.cleanup();
  }
});
