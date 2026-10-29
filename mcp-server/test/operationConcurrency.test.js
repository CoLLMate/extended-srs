// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSRSFixture } from './fixture.js';
import { withMCP, document, requirement, manifest } from './mcpClient.js';

async function until(check) {
  const deadline = Date.now() + 12000;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('Probe barrier timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function preload(fx, body, run) {
  const file = path.join(fx.root, 'audit-hook.cjs');
  await fs.writeFile(file, body);
  const old = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = (old ?? '') + ' --require=' + file;
  try {
    return await run();
  } finally {
    if (old === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = old;
    }
  }
}

test('concurrent gate approvals cannot both succeed without completing the status transition', async () => {
  const gate = (id) => ({
    gate_id: id,
    gate_type: 'content',
    required_for: ['tentative_to_approved'],
    on_approval_status_transition: 'approved',
  });
  const source = document({
    manifest: manifest(),
    'functional-requirements': { requirements: [requirement('FR-AUDIT', 'tentative')] },
    workflow: { config: { approval_gates: [gate('first'), gate('second')] } },
  });
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    const ids = await withMCP(fx, async (call) => {
      const first = await call('submit_for_review', {
        element_id: 'FR-AUDIT',
        gate_type: 'content',
        gate_id: 'first',
      });
      const second = await call('submit_for_review', {
        element_id: 'FR-AUDIT',
        gate_type: 'content',
        gate_id: 'second',
      });
      assert.equal(first.success, true, JSON.stringify(first));
      assert.equal(second.success, true, JSON.stringify(second));
      return [first.review_id, second.review_id];
    });
    const barrier = path.join(fx.root, 'barrier');
    await fs.mkdir(barrier);
    const release = path.join(barrier, 'release');
    await preload(
      fx,
      `
      if(process.argv[1]?.endsWith('/dist/index.js')) {
        const cp=require('node:child_process');
        const fs=require('node:fs');
        const exec=cp.execFileSync;
        cp.execFileSync=(file,args,options)=>{
          if(args[0]?.endsWith('/reviewStorageWorker.js')) {
            const request=JSON.parse(options.input);
            if(request.record && !request.record.allocateId) {
              fs.writeFileSync(${JSON.stringify(barrier)}+'/'+process.pid+'.ready','ready');
              const flag=new Int32Array(new SharedArrayBuffer(4));
              const deadline=Date.now()+15000;
              while(!fs.existsSync(${JSON.stringify(release)})){
                if(Date.now()>deadline) throw new Error('Worker barrier timed out');
                Atomics.wait(flag,0,0,10);
              }
            }
          }
          return exec(file,args,options);
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(fx, (first) =>
          withMCP(fx, async (second) => {
            const ready = async () =>
              (await fs.readdir(barrier)).filter((f) => f.endsWith('.ready')).length;
            const one = first('approve_review', { element_id: 'FR-AUDIT', review_id: ids[0] });
            await until(async () => (await ready()) === 1);
            let finished = false;
            const two = second('approve_review', {
              element_id: 'FR-AUDIT',
              review_id: ids[1],
            }).then((result) => {
              finished = true;
              return result;
            });
            try {
              await until(async () => finished || (await ready()) === 2);
            } finally {
              await fs.writeFile(release, 'go');
            }
            const results = await Promise.all([one, two]);
            assert.equal(results[0].success, true, JSON.stringify(results));
            assert.equal(results[1].success, false, JSON.stringify(results));
            assert.match(results[1].error, /concurrent|conflict/i);
            const pending = await first('get_review_history', { element_id: 'FR-AUDIT' });
            assert.deepEqual(
              pending.reviews.map((r) => r.status),
              ['approved', 'pending'],
            );
            const retry = await second('approve_review', {
              element_id: 'FR-AUDIT',
              review_id: ids[1],
            });
            assert.equal(retry.success, true, JSON.stringify(retry));
            assert.equal(retry.transition.new_status, 'approved');
            const history = await first('get_review_history', { element_id: 'FR-AUDIT' });
            const state = await first('get_project_state');
            assert.deepEqual(
              history.reviews.map((r) => r.status),
              ['approved', 'approved'],
            );
            assert.equal(state.elements[0].status, 'approved');
          }),
        ),
    );
  } finally {
    await fx.cleanup();
  }
});

test('auto-commit cannot include a concurrent write whose caller disabled commits', async () => {
  const source = document({
    manifest: manifest(),
    'functional-requirements': { requirements: [requirement('FR-AUDIT')] },
  });
  const fx = await createSRSFixture({ files: { 'srs.md': source } });
  try {
    const before = fx.git(['rev-parse', 'HEAD']).trim();
    const ready = path.join(fx.root, 'git-ready');
    const release = path.join(fx.root, 'git-release');
    await preload(
      fx,
      `
      if(process.argv[1]?.endsWith('/dist/index.js') && process.env.EXTSRS_AUTO_COMMIT==='true') {
        const cp=require('node:child_process');
        const fs=require('node:fs');
        const exec=cp.spawnSync;
        cp.spawnSync=(file,args,options)=>{
          if(args[0]?.endsWith('/gitCommitWorker.js')) {
            fs.writeFileSync(${JSON.stringify(ready)},'ready');
            const flag=new Int32Array(new SharedArrayBuffer(4));
            const deadline=Date.now()+15000;
            while(!fs.existsSync(${JSON.stringify(release)})){
              if(Date.now()>deadline) throw new Error('Worker barrier timed out');
              Atomics.wait(flag,0,0,10);
            }
          }
          return exec(file,args,options);
        };
        require('node:module').syncBuiltinESMExports();
      }
    `,
      () =>
        withMCP(
          fx,
          (first) =>
            withMCP(fx, async (second) => {
              const one = first('set_element_status', {
                element_id: 'FR-AUDIT',
                new_status: 'approved',
              });
              let two;
              try {
                await until(() =>
                  fs.access(ready).then(
                    () => true,
                    () => false,
                  ),
                );
                two = await second('set_element_status', {
                  element_id: 'FR-AUDIT',
                  new_status: 'dropped',
                });
                assert.equal(two.success, false, JSON.stringify(two));
                assert.match(two.error, /concurrent|conflict/i);
                assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), before);
              } finally {
                await fs.writeFile(release, 'go');
              }
              const result = await one;
              assert.equal(result.success, true, JSON.stringify(result));
              const committed = fx.git(['show', result.commit_sha + ':spec/srs.md']);
              const commits = fx.git(['log', '--format=%h %s', before + '..HEAD']).trim();
              assert.match(committed, /"status": "approved"/);
              assert.match(commits, /draft → approved/);
              assert.equal(fx.git(['status', '--porcelain', '--', 'spec/srs.md']).trim(), '');
              const retry = await second('set_element_status', {
                element_id: 'FR-AUDIT',
                new_status: 'dropped',
              });
              assert.equal(retry.success, true, JSON.stringify(retry));
              assert.equal(retry.commit_sha, null);
              assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), result.commit_sha);
              assert.match(await fx.readFile('srs.md'), /"status": "dropped"/);
              assert.match(
                fx.git(['status', '--porcelain', '--', 'spec/srs.md']),
                /^ M spec\/srs\.md/m,
              );
            }),
          true,
        ),
    );
  } finally {
    await fx.cleanup();
  }
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`keeper ${signal} during Git cannot admit another writer into the commit`, async () => {
    const source = document({
      manifest: manifest(),
      'functional-requirements': { requirements: [requirement('FR-AUDIT')] },
    });
    const fx = await createSRSFixture({ files: { 'srs.md': source } });
    try {
      const before = fx.git(['rev-parse', 'HEAD']).trim();
      const ready = path.join(fx.root, 'git-ready');
      const release = path.join(fx.root, 'git-release');
      const pidFile = path.join(fx.root, 'keeper-pid');
      const exiting = path.join(fx.root, 'keeper-exiting');
      await preload(
        fx,
        `
        if(process.env.EXTSRS_AUTO_COMMIT==='true') {
          const fs=require('node:fs');
          if(process.argv[1]?.endsWith('/dist/index.js')) {
            const cp=require('node:child_process');
            const fork=cp.fork;
            cp.fork=(file,args,options)=>{
              const child=fork(file,args,options);
              if(file.endsWith('/mutationWorker.js')) fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
              return child;
            };
            require('node:module').syncBuiltinESMExports();
          }
          if(process.argv[1]?.endsWith('/mutationWorker.js')) {
            const kill=process.kill;
            process.kill=(pid,signal)=>{
              // signal-exit re-sends the signal after its exit cleanup has run.
              if(pid===process.pid) fs.writeFileSync(${JSON.stringify(exiting)},'ready');
              return kill.call(process,pid,signal);
            };
          }
          if(process.argv[1]?.endsWith('/gitCommitWorker.js')) {
            fs.writeFileSync(${JSON.stringify(ready)},'ready');
            const flag=new Int32Array(new SharedArrayBuffer(4));
            const deadline=Date.now()+15000;
            while(!fs.existsSync(${JSON.stringify(release)})){
              if(Date.now()>deadline) throw new Error('Worker barrier timed out');
              Atomics.wait(flag,0,0,10);
            }
          }
        }
        `,
        () =>
          withMCP(
            fx,
            (first) =>
              withMCP(fx, async (second) => {
                const one = first('set_element_status', {
                  element_id: 'FR-AUDIT',
                  new_status: 'approved',
                });
                try {
                  await until(() =>
                    fs.access(ready).then(
                      () => true,
                      () => false,
                    ),
                  );
                  process.kill(Number(await fs.readFile(pidFile, 'utf8')), signal);
                  await until(() =>
                    fs.access(exiting).then(
                      () => true,
                      () => false,
                    ),
                  );
                  const two = await second('set_element_status', {
                    element_id: 'FR-AUDIT',
                    new_status: 'dropped',
                  });
                  assert.equal(two.success, false, JSON.stringify(two));
                  assert.match(two.error, /concurrent|conflict/i);
                  assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), before);
                } finally {
                  await fs.writeFile(release, 'go');
                }
                const result = await one;
                assert.equal(result.success, true, JSON.stringify(result));
                assert.match(
                  fx.git(['show', result.commit_sha + ':spec/srs.md']),
                  /"status": "approved"/,
                );
                assert.equal(fx.git(['status', '--porcelain', '--', 'spec/srs.md']).trim(), '');
                const expired = new Date(Date.now() - 180000);
                await fs.utimes(path.join(fx.specRoot, '.srs-mutation.lock'), expired, expired);
                const retry = await second('set_element_status', {
                  element_id: 'FR-AUDIT',
                  new_status: 'dropped',
                });
                assert.equal(retry.success, true, JSON.stringify(retry));
                assert.equal(retry.commit_sha, null);
                assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), result.commit_sha);
                assert.match(await fx.readFile('srs.md'), /"status": "dropped"/);
              }),
            true,
          ),
      );
    } finally {
      await fx.cleanup();
    }
  });
}
