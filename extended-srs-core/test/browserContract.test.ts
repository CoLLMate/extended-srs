// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const entry = fileURLToPath(new URL('./contracts/browser-consumer.ts', import.meta.url));

it('type-checks consumers against the built package with browser types and package exports', () => {
  const program = ts.createProgram([entry], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  });
  const errors = ts.getPreEmitDiagnostics(program);
  expect(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))).toEqual(
    [],
  );
});

it('bundles and executes the published entry points without Node globals or Node polyfills', async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, name: 'CoreConsumer', formats: ['iife'] } },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const chunks = outputs.flatMap((result) => ('output' in result ? result.output : []));
  expect(chunks).toHaveLength(1);
  const chunk = chunks[0];
  expect(chunk.type).toBe('chunk');
  if (chunk.type !== 'chunk') {
    throw new Error('Expected a browser bundle');
  }
  expect(chunk.imports).toEqual([]);
  expect(chunk.code).not.toContain('__vite-browser-external');
  // The isolated realm has JS built-ins, but no process, Buffer, require, fs,
  // or application-provided polyfills. Both module initialization and calls run here.
  const result = await runInNewContext(
    `${chunk.code}\nCoreConsumer.exercise()`,
    { console },
    { timeout: 10000 },
  );
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    sameAggregation: true,
    manifestPath: 'srs.md',
    parsed: 1,
    schema: true,
    unknownPath: null,
    unknownPreserved: true,
    unknownReported: true,
    extensionPreserved: true,
    locale: 'en',
    element: 'draft',
    ready: 'spec',
    status: 'approved',
    review: 'approved',
    pairs: 1,
    invalidTransition: true,
  });
}, 30000);
