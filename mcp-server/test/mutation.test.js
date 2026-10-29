// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMutation } from '../dist/io/mutation.js';
import { openStorageRoot } from '../dist/io/storageRoot.js';
import { readDocument, replaceDocument } from '../dist/io/documentStorage.js';
import { commitFile } from '../dist/io/git.js';
import { createSRSFixture } from './fixture.js';

const worker = fileURLToPath(new URL('../dist/io/mutationWorker.js', import.meta.url));

function interceptKeeper(t, transform) {
  const original = childProcess.fork;
  t.mock.method(childProcess, 'fork', (filename, args, options) =>
    transform(original, filename, args, options),
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

test('mutation locks serialize root aliases, allow other roots, and release on callback failure', async (t) => {
  const first = await createSRSFixture({ files: { 'srs.md': 'one' } });
  const second = await createSRSFixture({ files: { 'srs.md': 'two' } });
  t.after(() => first.cleanup());
  t.after(() => second.cleanup());
  const alias = path.join(first.root, 'alias');
  await fs.symlink(first.specRoot, alias, 'dir');
  await assert.rejects(
    withMutation(first.specRoot, async (root) => {
      assert.equal((await readDocument(root, 'srs.md')).content, 'one');
      await assert.rejects(
        withMutation(alias, async () => assert.fail('alias entered')),
        /Concurrent SRS update conflict/,
      );
      await withMutation(second.specRoot, async (other) => {
        await replaceDocument(other, 'srs.md', 'two', 'updated');
      });
      throw new Error('Fixture domain failure');
    }),
    /Fixture domain failure/,
  );
  await withMutation(first.specRoot, async (root) => {
    await replaceDocument(root, 'srs.md', 'one', 'after failure');
  });
  assert.equal(await first.readFile('srs.md'), 'after failure');
  assert.equal(await second.readFile('srs.md'), 'updated');
  assert.deepEqual(await fs.readdir(first.specRoot), ['srs.md']);
});

for (const kind of ['active', 'abandoned', 'symlink', 'file']) {
  test(`mutation lock handles ${kind} lock entries safely`, async (t) => {
    const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
    t.after(() => fx.cleanup());
    const lock = path.join(fx.specRoot, '.srs-mutation.lock');
    const outside = path.join(fx.root, 'outside');
    await fs.mkdir(outside);
    const before = await fs.stat(outside);
    if (kind === 'symlink') {
      await fs.symlink(outside, lock, 'dir');
    } else if (kind === 'file') {
      await fs.writeFile(lock, 'preserve');
    } else {
      await fs.mkdir(lock);
      if (kind === 'abandoned') {
        const past = new Date(Date.now() - 180000);
        await fs.utimes(lock, past, past);
      }
    }
    const action = withMutation(fx.specRoot, async (root) => {
      await replaceDocument(root, 'srs.md', 'original', 'updated');
    });
    if (kind === 'abandoned') {
      await action;
      assert.equal(await fx.readFile('srs.md'), 'updated');
      assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
    } else {
      await assert.rejects(action, /Concurrent SRS update conflict|Unsafe SRS mutation path/);
      assert.equal(await fx.readFile('srs.md'), 'original');
    }
    assert.equal((await fs.stat(outside)).mtimeMs, before.mtimeMs);
  });
}

for (const waitForTurn of [false, true]) {
  test(`keeper exit before its contention response preserves ${waitForTurn ? 'waiting' : 'conflict reporting'}`, async (t) => {
    const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
    const entered = Promise.withResolvers();
    const relinquish = Promise.withResolvers();
    const holding = withMutation(fx.specRoot, async () => {
      entered.resolve();
      await relinquish.promise;
    });
    try {
      await Promise.race([entered.promise, holding]);
      let attempts = 0;
      let delayedResponse = false;
      interceptKeeper(t, (original, filename, args, options) => {
        const keeper = original(filename, args, options);
        attempts++;
        if (attempts !== 1) {
          return keeper;
        }
        const emit = keeper.emit.bind(keeper);
        let pending;
        keeper.emit = (event, ...values) => {
          if (event === 'message' && values[0].error?.code === 'ELOCKED') {
            pending = values;
            return true;
          }
          if (event === 'close' && pending) {
            // exit can precede buffered IPC; close follows its delivery.
            setImmediate(() => {
              delayedResponse = true;
              if (waitForTurn) {
                relinquish.resolve();
              }
              emit('message', ...pending);
              emit('close', ...values);
            });
            return true;
          }
          return emit(event, ...values);
        };
        return keeper;
      });
      const operation = withMutation(
        fx.specRoot,
        async (root) => {
          assert.equal(waitForTurn, true, 'a contending writer must not enter');
          await replaceDocument(root, 'srs.md', 'original', 'updated');
        },
        waitForTurn,
      );
      if (waitForTurn) {
        await operation;
        assert.ok(attempts > 1, 'contention must be retried');
        assert.equal(await fx.readFile('srs.md'), 'updated');
      } else {
        await assert.rejects(operation, /Concurrent SRS update conflict/);
        assert.equal(await fx.readFile('srs.md'), 'original');
      }
      assert.equal(delayedResponse, true, 'the response must follow exit');
    } finally {
      relinquish.resolve();
      await holding;
      await fx.cleanup();
    }
  });
}

test('a queued ready response from an exited keeper cannot enter the callback', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
  t.after(() => fx.cleanup());
  let delayedReady = false;
  interceptKeeper(t, (original, filename, args, options) => {
    const keeper = original(filename, args, options);
    const emit = keeper.emit.bind(keeper);
    let pending;
    keeper.emit = (event, ...values) => {
      if (event === 'message' && values[0].ready) {
        pending = values;
        keeper.kill('SIGKILL');
        return true;
      }
      if (event === 'close' && pending) {
        setImmediate(() => {
          delayedReady = true;
          emit('message', ...pending);
          emit('close', ...values);
        });
        return true;
      }
      return emit(event, ...values);
    };
    return keeper;
  });
  await assert.rejects(
    withMutation(fx.specRoot, async () => assert.fail('entered without a live keeper')),
    /lock was lost/,
  );
  assert.equal(delayedReady, true);
  assert.equal(await fx.readFile('srs.md'), 'original');
});

for (const failure of ['spawn', 'before ready', 'after ready']) {
  test(`keeper failure ${failure} cannot leave a callback writing without its lock`, async (t) => {
    const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
    t.after(() => fx.cleanup());
    let keeper;
    interceptKeeper(t, (original, filename, args, options) => {
      keeper = original(
        filename,
        args,
        failure === 'spawn' ? { ...options, cwd: path.join(fx.root, 'absent') } : options,
      );
      if (failure === 'before ready') {
        keeper.kill('SIGKILL');
      }
      return keeper;
    });
    await assert.rejects(
      withMutation(fx.specRoot, async (root) => {
        assert.equal(failure, 'after ready');
        const exited = once(keeper, 'exit');
        keeper.kill('SIGKILL');
        await exited;
        await replaceDocument(root, 'srs.md', 'original', 'must not write');
      }),
      /lock was lost|ENOENT/,
    );
    assert.equal(await fx.readFile('srs.md'), 'original');
  });
}

for (const failure of ['SIGTERM', 'SIGINT', 'SIGHUP', 'exit', 'exception', 'rejection']) {
  test(`keeper ${failure} retains its lease until in-flight I/O has stopped`, async (t) => {
    const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
    t.after(() => fx.cleanup());
    const root = await openStorageRoot(fx.specRoot);
    t.after(() => root.close());
    const preload = path.join(fx.root, 'crash-keeper.cjs');
    const crash = {
      exit: 'process.exit(73)',
      exception: 'throw new Error("Fixture keeper failure")',
      rejection: 'Promise.reject(new Error("Fixture keeper failure"))',
    }[failure];
    await fs.writeFile(
      preload,
      crash
        ? `const send = process.send.bind(process);
           process.send = (message) => {
             const result = send(message);
             if (message.ready) setImmediate(() => { ${crash}; });
             return result;
           };`
        : '',
    );
    const keeper = childProcess.fork(worker, [], {
      cwd: root.path,
      execArgv: ['--require', preload],
      stdio: ['ignore', 'ignore', 'ignore', root.directory.fd, 'ipc'],
    });
    t.after(() => keeper.kill('SIGKILL'));
    const exited = once(keeper, 'exit');
    const [ready] = await once(keeper, 'message');
    assert.equal(ready.ready, true, JSON.stringify(ready));
    if (!crash) {
      keeper.kill(failure);
    }
    await exited;
    const lock = path.join(fx.specRoot, '.srs-mutation.lock');
    assert.equal((await fs.lstat(lock)).isDirectory(), true);
    await assert.rejects(
      withMutation(fx.specRoot, async () => assert.fail('entered while I/O may be active')),
      /Concurrent SRS update conflict/,
    );
    assert.equal(await fx.readFile('srs.md'), 'original');
    // Once the abandoned lease expires, an ordinary update can recover it.
    const expired = new Date(Date.now() - 180000);
    await fs.utimes(lock, expired, expired);
    await withMutation(fx.specRoot, async (next) => {
      await replaceDocument(next, 'srs.md', 'original', 'recovered');
    });
    assert.equal(await fx.readFile('srs.md'), 'recovered');
    assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
  });
}

test('the operation deadline stops subsequent writes and commits', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
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
  const head = fx.git(['rev-parse', 'HEAD']);
  await withMutation(fx.specRoot, async (root) => {
    root.mutationDeadline = Date.now() - 1;
    await assert.rejects(
      replaceDocument(root, 'srs.md', 'original', 'must not write'),
      /timed out/,
    );
    assert.equal(commitFile(root, 'srs.md', 'must not commit'), null);
  });
  assert.equal(await fx.readFile('srs.md'), 'original');
  assert.equal(fx.git(['rev-parse', 'HEAD']), head);
  assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
});

test('keeper acquisition rejects a root replaced before entering it', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
  t.after(() => fx.cleanup());
  const outside = path.join(fx.root, 'outside');
  await fs.mkdir(outside);
  // Async fork starts after the open root descriptor has been captured.
  const root = await fs.realpath(fx.specRoot);
  const original = childProcess.fork;
  t.mock.method(childProcess, 'fork', (filename, args, options) => {
    const bootstrap = path.join(fx.root, 'swap.cjs');
    return original(filename, args, { ...options, execArgv: ['--require', bootstrap] });
  });
  await fs.writeFile(
    path.join(fx.root, 'swap.cjs'),
    `
    const fs = require('node:fs');
    const stat = fs.statSync;
    fs.statSync = (name, ...args) => {
      if (name === '.') {
        fs.renameSync(${JSON.stringify(root)}, ${JSON.stringify(root + '-original')});
        fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(root)}, 'dir');
        process.chdir(${JSON.stringify(root)});
      }
      return stat(name, ...args);
    };
    require('node:module').syncBuiltinESMExports();
  `,
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    withMutation(fx.specRoot, async () => assert.fail('entered replacement root')),
    /directory changed/,
  );
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await fs.readFile(path.join(root + '-original', 'srs.md'), 'utf8'), 'original');
});

test('an interrupted parent leaves a lease instead of immediately admitting another writer', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
  t.after(() => fx.cleanup());
  const root = await openStorageRoot(fx.specRoot);
  t.after(() => root.close());
  const keeper = childProcess.fork(worker, [], {
    cwd: root.path,
    stdio: ['ignore', 'ignore', 'ignore', root.directory.fd, 'ipc'],
  });
  const [ready] = await once(keeper, 'message');
  assert.equal(ready.ready, true);
  const exited = once(keeper, 'exit');
  keeper.disconnect();
  const [, signal] = await exited;
  assert.equal(signal, 'SIGKILL');
  assert.ok((await fs.stat(path.join(root.path, '.srs-mutation.lock'))).isDirectory());
  await assert.rejects(
    withMutation(root.path, async () => assert.fail('interrupted write overlapped')),
    /Concurrent SRS update conflict/,
  );
});

test('a timed-out Git worker cannot leave a child writing after the operation unlocks', async (t) => {
  const fx = await createSRSFixture({ files: { 'srs.md': 'original' } });
  t.after(() => fx.cleanup());
  const previousOptions = process.env.NODE_OPTIONS;
  const previousCommit = process.env.EXTSRS_AUTO_COMMIT;
  const preload = path.join(fx.root, 'slow-git.cjs');
  const marker = path.join(fx.root, 'child-started');
  const filename = path.join(fx.specRoot, 'srs.md');
  await fs.writeFile(
    preload,
    `
    if (process.argv[1]?.endsWith('/gitCommitWorker.js')) {
      const fs = require('node:fs');
      const child = require('node:child_process').spawn(process.execPath, ['-e',
        'setTimeout(() => require("node:fs").writeFileSync(' + ${JSON.stringify(JSON.stringify(filename))} + ', "orphan write"), 3000)'
      ], { stdio: 'ignore' });
      fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    }
  `,
  );
  process.env.NODE_OPTIONS = `${previousOptions ?? ''} --require=${preload}`;
  process.env.EXTSRS_AUTO_COMMIT = 'true';
  t.after(() => {
    if (previousOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = previousOptions;
    }
    if (previousCommit === undefined) {
      delete process.env.EXTSRS_AUTO_COMMIT;
    } else {
      process.env.EXTSRS_AUTO_COMMIT = previousCommit;
    }
  });
  await withMutation(fx.specRoot, async (root) => {
    root.mutationDeadline = Date.now() + 1500;
    assert.equal(commitFile(root, 'srs.md', 'fixture commit'), null);
  });
  assert.match(await fs.readFile(marker, 'utf8'), /^\d+$/);
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.equal(await fx.readFile('srs.md'), 'original');
  assert.deepEqual(await fs.readdir(fx.specRoot), ['srs.md']);
});
