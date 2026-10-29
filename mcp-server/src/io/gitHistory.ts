// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { CoreDocument } from 'extended-srs-core/api';
import { git, literalPath } from './git.js';
import type { StorageRoot } from './storageRoot.js';

export interface GitCommit {
  sha: string;
  parent: string;
  author: string;
  date: string;
  message: string;
}

/** First-parent order represents the successive project snapshots on this branch. */
export function readCommits(projectPath: StorageRoot, since?: string): GitCommit[] {
  let raw: string;
  try {
    raw = git(
      [
        'log',
        '--first-parent',
        '-z',
        '--format=%H%x00%P%x00%an%x00%aI%x00%s',
        ...(since ? [`--since=${since}`] : []),
        '--',
        '*.md',
      ],
      projectPath,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'UNSAFE_SRS_PATH') {
      throw error;
    }
    return [];
  }
  const fields = raw.split('\0');
  const commits: GitCommit[] = [];
  for (let i = 0; i + 4 < fields.length; i += 5) {
    commits.push({
      sha: fields[i],
      parent: fields[i + 1].split(' ')[0],
      author: fields[i + 2],
      date: fields[i + 3],
      message: fields[i + 4],
    });
  }
  return commits;
}

/** Read committed regular files under the selected SRS root, including deleted/renamed documents. */
export function readSnapshot(projectPath: StorageRoot, sha: string): CoreDocument[] {
  const entries = git(['ls-tree', '-r', '-z', sha, '--', '.'], projectPath)
    .split('\0')
    .filter(Boolean);
  return entries.flatMap((entry) => {
    const separator = entry.indexOf('\t');
    const metadata = entry.slice(0, separator);
    const filename = entry.slice(separator + 1);
    if (
      !/^100(644|755) blob /.test(metadata) ||
      !filename.endsWith('.md') ||
      filename.split('/').includes('node_modules')
    ) {
      return [];
    }
    return [{ path: filename, content: git(['show', `${sha}:./${filename}`], projectPath) }];
  });
}

export function changedFilesSummary(
  projectPath: StorageRoot,
  commit: GitCommit,
  files: string[],
): string {
  const paths = files.map(literalPath);
  if (!commit.parent) {
    return '(initial commit)';
  }
  return git(['diff', '--stat', commit.parent, commit.sha, '--', ...paths], projectPath).trim();
}
