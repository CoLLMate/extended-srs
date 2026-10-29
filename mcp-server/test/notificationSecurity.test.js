// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { notifyReviewEvent } from '../dist/integrations/reviewNotifications.js';

async function listen(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`notification HTTP ${status} cannot forward the project token to another origin`, async (t) => {
    const forwarded = [];
    const destination = await listen(t, (request, response) => {
      forwarded.push(request.headers['x-project-token']);
      request.resume();
      response.writeHead(204).end();
    });
    const delivered = [];
    const source = await listen(t, (request, response) => {
      delivered.push(request.headers['x-project-token']);
      request.resume();
      response.writeHead(status, { Location: `${destination}/collect` }).end();
    });
    const environment = {
      AGENT_COMMUNICATION_URL: source,
      TEAM_ID: 'fixture-team',
      PROJECT_ID: 'fixture-project',
      GIT_AUTH_TOKEN: 'fixture-not-a-real-token',
    };
    const previous = Object.fromEntries(
      Object.keys(environment).map((key) => [key, process.env[key]]),
    );
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
    Object.assign(process.env, environment);
    await notifyReviewEvent('review_submitted', 'FR-AUDIT', 1);
    assert.deepEqual(delivered, [environment.GIT_AUTH_TOKEN]);
    assert.deepEqual(forwarded, []);
  });
}
