// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import * as YAML from 'yaml';
import { spawnSync } from 'node:child_process';
import {
  extractYAMLBlocks,
  parseYAMLBlock,
  validateExtendedSRS,
  validateExtendedSRSFile,
  validateYAML,
} from '../src';

vi.mock('yaml', async (importOriginal) => {
  const original = await importOriginal<typeof YAML>();
  return { ...original, parseDocument: vi.fn(original.parseDocument) };
});

const manifest = { format: 'extended-srs/v1', project_name: 'Validation parity' };
const markdown = (yaml: string) => `# Example\n\n<!--@srs\n${yaml}\n@srs-->`;
const normalize = (result: Awaited<ReturnType<typeof validateExtendedSRS>>) => ({
  isValid: result.isValid,
  errors: result.errors.map(({ severity, type }) => ({ severity, type })),
  warnings: result.warnings.map(({ message, type, severity, path }) => ({
    message,
    type,
    severity,
    path: path
      .replace(/^\//, '')
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .join('.'),
  })),
});

describe('validation entry point agreement', () => {
  it.each([
    { manifest, 'project-overview': { objective: 'Example', extra: { retained: true } } },
    { manifest, '0': 'a numeric unknown property' },
    { manifest, 'x-extension': { freely: 'defined' } },
  ])(
    'retains data and reports the same unknown-property warnings for $manifest.project_name',
    async (data) => {
      const before = JSON.stringify(data);
      const yaml = YAML.stringify(data);
      const structured = await validateExtendedSRS(data);
      expect(structured.isValid).toBe(true);
      expect(normalize(await validateYAML(yaml))).toEqual(normalize(structured));
      expect(normalize(await validateExtendedSRSFile(markdown(yaml)))).toEqual(
        normalize(structured),
      );
      expect(JSON.stringify(data)).toBe(before);
      expect(parseYAMLBlock(extractYAMLBlocks(markdown(yaml))[0]).data).toEqual(data);
      if (!('x-extension' in data)) {
        expect(structured.warnings).toEqual([
          expect.objectContaining({
            type: 'unknown-property',
            severity: 'warning',
            message: expect.stringContaining('保持'),
          }),
        ]);
      } else {
        expect(structured.warnings).toEqual([]);
      }
    },
  );

  it('reports unknown properties in partial blocks with the same message and type', async () => {
    const structured = await validateExtendedSRS({
      manifest,
      'project-overview': { objective: 'Example', extra: 1 },
    });
    const partial = await validateYAML(
      'objective: Example\nextra: 1',
      0,
      ['project-overview'],
      true,
    );
    expect(partial.isValid).toBe(true);
    expect(partial.errors).toEqual([]);
    expect(partial.warnings[0]).toMatchObject({
      type: structured.warnings[0].type,
      message: structured.warnings[0].message,
      severity: 'warning',
    });
    const field = await validateYAML('retained', 0, ['project-overview', 'extra'], true);
    expect(field.isValid).toBe(true);
    expect(field.warnings).toEqual([expect.objectContaining({ type: 'unknown-property' })]);
  });

  it('keeps wrong types and missing required fields as errors even alongside unknown properties', async () => {
    const data = { manifest: { project_name: 123, extra: true } };
    for (const result of [
      await validateExtendedSRS(data),
      await validateYAML(YAML.stringify(data)),
      await validateExtendedSRSFile(markdown(YAML.stringify(data))),
    ]) {
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings).toEqual([expect.objectContaining({ type: 'unknown-property' })]);
    }
  });

  it('parses each Markdown metadata block only once', async () => {
    const parse = vi.mocked(YAML.parseDocument).mockClear();
    try {
      await validateExtendedSRSFile(
        markdown('manifest: {format: extended-srs/v1, project_name: Example}'),
      );
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockClear();
    }
  });
});

describe('bounded, linear YAML parsing', () => {
  it.each([
    'x: 1\nx: 2',
    'x: {a: 1, a: 2}',
    'x: [{a: 1, "a": 2}]',
    'x: {0x10: a, 16: b}',
    'x: {true: a, TRUE: b}',
    'x: {null: a, ~: b}',
    'x: {0: a, -0: b}',
    'x: {a: &value 1, a: *value}',
  ])('rejects duplicate keys without silently overwriting values: %s', async (yaml) => {
    const content = markdown(yaml);
    expect(parseYAMLBlock(extractYAMLBlocks(content)[0]).error).toMatch(/Map keys must be unique/);
    for (const result of [await validateYAML(yaml), await validateExtendedSRSFile(content)]) {
      expect(result.isValid).toBe(false);
      expect(result.errors.some((error) => error.message.includes('Map keys must be unique'))).toBe(
        true,
      );
    }
  });

  it('preserves ordinary aliases, comments, flow maps, and independently scoped key names', () => {
    const yaml = 'first: &shared {key: value} # comment\nsecond: *shared\nthird: {key: other}';
    const parsed = parseYAMLBlock(extractYAMLBlocks(markdown(yaml))[0]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({
      first: { key: 'value' },
      second: { key: 'value' },
      third: { key: 'other' },
    });
  });

  it('preserves the installed YAML parser comparison for NaN keys', () => {
    const parsed = parseYAMLBlock(extractYAMLBlocks(markdown('.nan: first\n.nan: second'))[0]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({ NaN: 'second' });
  });

  it('rejects oversized UTF-8 metadata before invoking the YAML parser', async () => {
    for (const yaml of [
      '#' + 'a'.repeat(4 * 1024 * 1024),
      '#' + 'あ'.repeat(2 * 1024 * 1024),
      '#' + '😀'.repeat(1024 * 1024),
      '#' + '\ud800'.repeat(2 * 1024 * 1024),
    ]) {
      const parse = vi.mocked(YAML.parseDocument).mockClear();
      try {
        expect((await validateYAML(yaml)).errors[0].message).toMatch(/4 MiB/);
        expect(parseYAMLBlock(extractYAMLBlocks(markdown(yaml))[0]).error).toMatch(/4 MiB/);
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockClear();
      }
    }
  });

  it.each(['a', 'é', 'あ', '😀'])(
    'accepts a metadata block exactly at the UTF-8 size limit (%s)',
    (character) => {
      const bytes = Buffer.byteLength(character);
      const count = Math.floor((4 * 1024 * 1024 - 1) / bytes);
      const yaml = '#' + character.repeat(count) + 'a'.repeat(4 * 1024 * 1024 - 1 - count * bytes);
      const parse = vi.mocked(YAML.parseDocument).mockClear();
      expect(parseYAMLBlock(extractYAMLBlocks(markdown(yaml))[0]).error).toBeUndefined();
      expect(parse).toHaveBeenCalledTimes(1);
    },
  );

  it('locates quoted unknown keys with slashes and tildes in the right mapping', async () => {
    const yaml =
      'manifest: {format: extended-srs/v1, project_name: Lines}\nproject-overview:\n  objective: Example\n  "a/b~c": 1\n  extra: 2';
    const result = await validateYAML(yaml);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: '/project-overview/a~1b~0c', line: 3 }),
      expect.objectContaining({ path: '/project-overview/extra', line: 4 }),
    ]);
  });

  it('validates 100,000 mapping keys without quadratic duplicate-key work', () => {
    const script = `const core=require('./dist/index.js');
      const yaml='manifest: {format: extended-srs/v1, project_name: Wide}\\nproject-overview:\\n  objective: Example\\n  extra:\\n'+
        Array.from({length:100000},(_,i)=>'    k'+i+': 1\\n').join('');
      core.validateExtendedSRSFile('<!--@srs\\n'+yaml+'@srs-->').then(result=>console.log(JSON.stringify(result)));`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=384', '-e', script], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 8000,
      killSignal: 'SIGKILL',
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  }, 15000);

  it('locates many unknown fields without rescanning the source for every warning', () => {
    const script = `const core=require('./dist/index.js');
      const yaml='manifest: {format: extended-srs/v1, project_name: Wide}\\n'+
        Array.from({length:30000},(_,i)=>'unknown'+i+': 1\\n').join('');
      core.validateYAML(yaml).then(result=>console.log(JSON.stringify({
        valid:result.isValid, count:result.warnings.length,
        first:result.warnings[0].line,last:result.warnings.at(-1).line
      })));`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=384', '-e', script], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 8000,
      killSignal: 'SIGKILL',
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ valid: true, count: 30000, first: 1, last: 30000 });
  }, 15000);
});
