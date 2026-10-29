// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test fixture helpers.
 *
 * createSRSFixture() builds a two-layer structure in a disposable temp
 * directory that mirrors the production model:
 *
 *     <mkdtemp>/                 ← parent repo (git init here)
 *     ├── spec/                  ← SRS root — MCP handlers receive this
 *     │   ├── srs.md
 *     │   ├── fr.md
 *     │   └── reviews/           ← review tool writes here (after refactor)
 *     └── (anything written via writeOutsideSpec lives here)
 *
 * Two-layer fixtures let tests verify the scope contract: MCP tools must
 * operate **only** on the SRS root subtree and must never read or commit
 * files from the surrounding parent repo (e.g. application code under
 * ``src/``). The ``writeOutsideSpec`` helper is the negative-control
 * affordance for this.
 *
 * Returned handle:
 *   - ``root``        — parent repo root (git toplevel)
 *   - ``specRoot``    — SRS root inside the parent repo; pass this to
 *                       every MCP handler as ``projectPath``
 *   - ``git``         — execute git inside the parent repo
 *   - ``writeFile``   — write a file **inside the SRS root** (rel to specRoot)
 *   - ``writeOutsideSpec`` — write a file **outside the SRS root**
 *                            (rel to parent repo root), for negative
 *                            control tests that prove the MCP tools do
 *                            not leak into the surrounding repo
 *   - ``readFile``    — read a file inside the SRS root
 *   - ``commitAll``   — `git add -A` + commit at parent repo level
 *   - ``cleanup``     — rm -rf the whole temp dir
 *
 * Usage:
 *   const fx = await createSRSFixture({ files: sampleSRSFiles });
 *   try {
 *     const result = await handleGetProjectState(fx.specRoot, {});
 *     // ...
 *   } finally {
 *     await fx.cleanup();
 *   }
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Subdirectory name used as the SRS root inside the parent repo.
 * Kept as a simple constant so tests can reference it if needed, but
 * tests are encouraged to use ``fx.specRoot`` rather than joining by hand.
 */
const SPEC_SUBDIR = 'spec';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Force deterministic identity so commits work in CI containers
      // and the user's global config doesn't leak in.
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      HOME: process.env.HOME || '/tmp',
    },
  });
}

/**
 * @param {object} opts
 * @param {Record<string, string>} opts.files - path relative to ``specRoot`` → content
 * @param {string} [opts.initialCommitMessage]
 * @returns {Promise<{
 *   root: string,
 *   specRoot: string,
 *   git: (args: string[]) => string,
 *   writeFile: (rel: string, content: string) => Promise<void>,
 *   writeOutsideSpec: (rel: string, content: string) => Promise<void>,
 *   readFile: (rel: string) => Promise<string>,
 *   commitAll: (msg: string) => string,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function createSRSFixture(opts) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'exsrs-test-'));
  const specRoot = path.join(root, SPEC_SUBDIR);

  // Ensure SRS root exists even when the caller passes no files.
  await fs.mkdir(specRoot, { recursive: true });

  // Write all the SRS files inside the spec subdirectory.
  for (const [rel, content] of Object.entries(opts.files || {})) {
    const full = path.join(specRoot, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  // Initialise the repo at the parent level and make an initial commit so
  // history-based tools have a parent to diff against. The SRS files land
  // under ``spec/`` from the repo's point of view.
  git(['init', '-q', '-b', 'main'], root);
  // Handlers launch Git themselves, outside this helper's per-command env.
  // Keep their identity in the disposable repo, never in the user's config.
  git(['config', '--local', 'user.name', 'Test Author'], root);
  git(['config', '--local', 'user.email', 'test@example.com'], root);
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', opts.initialCommitMessage || 'initial fixture'], root);

  return {
    root,
    specRoot,
    git: (args) => git(args, root),
    /**
     * Write a file inside the SRS root (rel is relative to ``specRoot``).
     * This is what tests should use for every SRS-scoped write.
     */
    async writeFile(rel, content) {
      const full = path.join(specRoot, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf-8');
    },
    /**
     * Write a file **outside** the SRS root, i.e. somewhere else inside
     * the parent repo. Used by negative-control tests to prove that MCP
     * tools do not leak into the surrounding repo.
     *
     * The path is resolved relative to the parent repo root. Passing
     * ``'src/app.md'`` writes ``<root>/src/app.md``.
     *
     * It is an error to point this at a path that resolves back inside
     * ``specRoot`` — the helper exists specifically to populate the
     * *outside* of the SRS root.
     */
    async writeOutsideSpec(rel, content) {
      const full = path.resolve(root, rel);
      const resolvedSpec = path.resolve(specRoot);
      if (full === resolvedSpec || full.startsWith(resolvedSpec + path.sep)) {
        throw new Error(`writeOutsideSpec refuses to write inside the SRS root: ${rel}`);
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf-8');
    },
    async readFile(rel) {
      return fs.readFile(path.join(specRoot, rel), 'utf-8');
    },
    commitAll(msg) {
      git(['add', '-A'], root);
      try {
        git(['diff', '--cached', '--quiet'], root);
        // No changes; return current HEAD.
        return git(['rev-parse', 'HEAD'], root).trim();
      } catch {
        git(['commit', '-q', '-m', msg], root);
        return git(['rev-parse', 'HEAD'], root).trim();
      }
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Canned content for a small but realistic SRS project.
 *
 * All paths are relative to the SRS root (``fx.specRoot``). The fixture
 * wires them up so an MCP handler called with ``fx.specRoot`` as its
 * ``projectPath`` sees exactly these files.
 *
 * The aggregator requires:
 *   - an entry file at the SRS root named ``srs.md``
 *   - whose ``manifest`` block lists the additional files to merge
 *
 * The fixture exercises:
 *   - prefix collisions (FR-001 vs FR-0010)
 *   - typed depends_on (hard / soft)
 *   - bare-string depends_on (lifted to ``{ ref_id }`` by normalize)
 *   - all five element types: use-case, FR, NFR, module, milestone
 */
export const sampleSRSFiles = {
  'srs.md': `# SRS Entry

<!--@srs
manifest:
  format: "extended-srs/v1"
  schema_version: "1.0.0"
  project_name: "Test Project"
  created: 1735516800
  files:
    - "use-cases.md"
    - "functional-requirements.md"
    - "non-functional-requirements.md"
    - "system-architecture.md"
    - "development-implementation.md"
@srs-->
`,
  'use-cases.md': `# Use Cases

<!--@srs
use-cases:
  list:
    - uc_id: "UC-001"
      name: "Login"
      status: "approved"
@srs-->

UC-001 covers the user login flow.
`,
  'functional-requirements.md': `# Functional Requirements

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-001"
      name: "Auth check"
      status: "draft"
      priority: "must"
      depends_on:
        - "UC-001"
    - req_id: "FR-0010"
      name: "Logout"
      status: "draft"
      priority: "should"
      depends_on:
        - ref_id: "FR-001"
          ref_type: "functional-requirement"
          dependency_type: "hard"
        - ref_id: "EXT-IDP"
          dependency_type: "soft"
@srs-->

FR-001 implements the auth check; FR-0010 wraps logout.
`,
  'system-architecture.md': `# Architecture

<!--@srs
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: "C-AUTH"
          modules:
            - module_id: "M-LOGIN"
              name: "Login Module"
              status: "approved"
@srs-->

The login module backs UC-001.
`,
  'non-functional-requirements.md': `# Non-Functional Requirements

<!--@srs
non-functional-requirements:
  list:
    - req_id: "NFR-001"
      name: "Login latency"
      category: "performance"
      priority: "must"
      status: "approved"
@srs-->

NFR-001 caps p95 login latency at 500 ms.
`,
  'development-implementation.md': `# Development Milestones

<!--@srs
development-implementation:
  development_milestones:
    milestones:
      - milestone_id: "M1"
        name: "Auth foundation"
        status: "approved"
        priority: "must"
@srs-->

M1 delivers the foundational auth flow.
`,
};
