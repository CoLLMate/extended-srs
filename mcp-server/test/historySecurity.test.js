// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSRSFixture } from './fixture.js';
import { withMCP, document, requirement, manifest } from './mcpClient.js';

for (const tool of ['get_status_history', 'get_change_log']) {
  for (const stage of ['before log', 'after log', 'retarget alias']) {
    test(`${tool}: ${stage} cannot redirect history outside the selected root`, async () => {
      const source = document({
        manifest: manifest(),
        'functional-requirements': { requirements: [requirement('FR-AUDIT')] },
      });
      const outsideSource = source.replace('"draft"', '"approved"');
      const fx = await createSRSFixture({ files: { 'srs.md': source } });
      const oldOptions = process.env.NODE_OPTIONS;
      try {
        const outside = path.join(fx.root, 'outside');
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, 'srs.md'), outsideSource);
        await fx.writeFile('srs.md', source + '\n');
        fx.commitAll('fixture documents');
        const alias = path.join(fx.root, 'alias');
        await fs.symlink(fx.specRoot, alias, 'dir');
        const preload = path.join(fx.root, 'history-race.cjs');
        await fs.writeFile(
          preload,
          `
          if(process.argv[1]?.endsWith('/dist/index.js')) {
            const cp=require('node:child_process');
            const fs=require('node:fs');
            const exec=cp.execFileSync;
            let swapped=false;
            function swap() {
              swapped=true;
              if(${JSON.stringify(stage)}==='retarget alias') {
                fs.unlinkSync(${JSON.stringify(alias)});
                fs.symlinkSync(${JSON.stringify(outside)},${JSON.stringify(alias)},'dir');
              } else {
                fs.renameSync(${JSON.stringify(fx.specRoot)},${JSON.stringify(fx.specRoot + '-saved')});
                fs.symlinkSync(${JSON.stringify(outside)},${JSON.stringify(fx.specRoot)},'dir');
              }
            }
            cp.execFileSync=(command,args,options)=>{
              const gitArgs=command==='git' ? args : args[0]?.endsWith('/gitReadWorker.js') ? JSON.parse(options.input).args : [];
              const boundary=!swapped && gitArgs[0]==='log';
              if(boundary && ${JSON.stringify(stage)}==='before log') swap();
              const result=exec(command,args,options);
              if(boundary && ${JSON.stringify(stage)}!=='before log') swap();
              return result;
            };
            require('node:module').syncBuiltinESMExports();
          }
        `,
        );
        process.env.NODE_OPTIONS = `${oldOptions ?? ''} --require=${preload}`;
        await withMCP(
          { ...fx, specRoot: stage === 'retarget alias' ? alias : fx.specRoot },
          async (call) => {
            const result = await call(tool, { element_id: 'FR-AUDIT' });
            if (stage === 'retarget alias') {
              assert.equal(result.success, true, JSON.stringify(result));
              if (tool === 'get_status_history') {
                assert.deepEqual(
                  result.history.map((item) => item.status),
                  ['draft'],
                );
              } else {
                assert.ok(result.changes.length > 0);
              }
            } else {
              assert.equal(result.success, false, JSON.stringify(result));
              assert.match(result.error, /directory changed|Unsafe SRS path/);
            }
          },
        );
      } finally {
        if (oldOptions === undefined) {
          delete process.env.NODE_OPTIONS;
        } else {
          process.env.NODE_OPTIONS = oldOptions;
        }
        await fx.cleanup();
      }
    });
  }
}
