// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  getCurrentLocale,
  getProjectState,
  getUnblockedElements,
  createReview,
  resolveReview,
  planElementStatusChange,
} from '../src';

it('runs rule APIs without Node globals, DOM, filesystem, clock or environment injection', () => {
  const globals = globalThis as any;
  const savedProcess = globals.process;
  const savedBuffer = globals.Buffer;
  let output: any;
  try {
    globals.process = undefined;
    globals.Buffer = undefined;
    const srs = {
      'functional-requirements': {
        requirements: [{ req_id: 'FR-1', name: 'Portable', status: 'draft' }],
      },
    };
    const metadata = { id: 1, actor: 'browser-user', timestamp: '2026-10-28T00:00:00Z' };
    const pending = createReview(srs, { element_id: 'FR-1', gate_type: 'content' }, metadata);
    const resolved = resolveReview(
      srs,
      [pending],
      { element_id: 'FR-1', review_id: 1 },
      'approved',
      metadata,
    );
    const content = `<!--@srs\n${JSON.stringify(srs)}\n@srs-->`;
    output = {
      locale: getCurrentLocale(),
      state: getProjectState(srs),
      ready: getUnblockedElements(srs),
      resolved,
      change: planElementStatusChange([{ path: 'srs.md', content }], {
        element_id: 'FR-1',
        action: 'approve',
      }),
    };
  } finally {
    globals.process = savedProcess;
    globals.Buffer = savedBuffer;
  }
  expect(output.locale).toBe('en');
  expect(output.state.elements[0].element_id).toBe('FR-1');
  expect(output.ready.elements[0].ready_for).toBe('spec');
  expect(output.resolved.review.status).toBe('approved');
  expect(output.change.new_status).toBe('approved');
});
