// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { spawnSync } from 'node:child_process';
import { extractYAMLBlocks, parseYAMLBlock, validateExtendedSRSFile, validateYAML } from '../src';

const markdown = (source: string) => `<!--@srs\n${source}\n@srs-->`;

describe('YAML parser compatibility', () => {
  it.each([
    { version: '1.2', flow: false, quoted: false, merge: false },
    { version: '1.2', flow: true, quoted: false, merge: false },
    { version: '1.1', flow: false, quoted: false, merge: true },
    { version: '1.1', flow: true, quoted: false, merge: true },
    { version: '1.1', flow: false, quoted: true, merge: false },
    { version: '1.1', flow: true, quoted: true, merge: false },
  ])(
    'preserves repeated << handling: $version, flow=$flow, quoted=$quoted',
    async ({ version, flow, quoted, merge }) => {
      const directive = version === '1.1' ? '%YAML 1.1\n---\n' : '';
      const key = quoted ? '"<<"' : '<<';
      const mapping = flow
        ? `{${key}: *base, ${key}: *other}`
        : `\n  ${key}: *base\n  ${key}: *other`;
      const source = `${directive}manifest: {format: extended-srs/v1, project_name: Merge}\nx-base: &base {a: 1, shared: first}\nx-other: &other {b: 2, shared: second}\nx-result: ${mapping}`;
      const baseline = YAML.parseDocument(source, { keepSourceTokens: true, strict: false });
      const parsed = parseYAMLBlock(extractYAMLBlocks(markdown(source))[0]);
      const validations = [
        await validateYAML(source),
        await validateExtendedSRSFile(markdown(source)),
      ];

      if (merge) {
        expect(baseline.errors).toEqual([]);
        expect(parsed.error).toBeUndefined();
        expect(parsed.data).toEqual(baseline.toJSON());
        expect(parsed.data['x-result']).toEqual({ a: 1, b: 2, shared: 'first' });
        for (const result of validations) {
          expect(result).toEqual({ isValid: true, errors: [], warnings: [] });
        }
      } else {
        expect(baseline.errors.some((error) => error.code === 'DUPLICATE_KEY')).toBe(true);
        expect(parsed.error).toMatch(/Map keys must be unique/);
        expect(parsed.data).toBeUndefined();
        for (const result of validations) {
          expect(result.isValid).toBe(false);
          expect(result.errors.some((error) => /Map keys must be unique/.test(error.message))).toBe(
            true,
          );
        }
      }
    },
  );

  it('rejects depth 2,000 through the public entry points and continues processing', () => {
    const script = `const core = require('./dist/index.js');
      const sources = [
        'x-data: ' + '['.repeat(2000) + '0' + ']'.repeat(2000),
        'x-data: ' + '{child: '.repeat(2000) + 'value' + '}'.repeat(2000),
        Array.from({length: 2000}, (_, i) => ' '.repeat(i) + 'child:').join('\\n') + '\\n' + ' '.repeat(2000) + 'value'
      ];
      (async () => {
        const results = [];
        for (const source of sources) {
          const content = '<!--@srs\\n' + source + '\\n@srs-->';
          const parsed = core.parseYAMLBlock(core.extractYAMLBlocks(content)[0]);
          const yaml = await core.validateYAML(source);
          const file = await core.validateExtendedSRSFile(content);
          results.push({ parsed: parsed.error, yaml: yaml.errors[0]?.message, file: file.errors[0]?.message,
            hasData: parsed.data !== undefined, yamlValid: yaml.isValid, fileValid: file.isValid });
        }
        const next = await core.validateYAML('manifest: {format: extended-srs/v1, project_name: Next}');
        console.log(JSON.stringify({ results, nextValid: next.isValid }));
      })();`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', script], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL',
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const { results, nextValid } = JSON.parse(child.stdout);
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toMatchObject({ hasData: false, yamlValid: false, fileValid: false });
      for (const message of [result.parsed, result.yaml, result.file]) {
        // The library may hit the runtime stack limit before core receives a parsed value.
        expect(message).toMatch(/nesting.*100|Maximum call stack size exceeded/);
      }
    }
    expect(nextValid).toBe(true);
  }, 15000);
});
