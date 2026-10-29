// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { core } from '../core.js';
import { readDocuments, type DocumentSnapshot } from './documentStorage.js';
import type { StoragePath } from './storageRoot.js';

export async function aggregateDocuments(snapshot: DocumentSnapshot, allowStandalone = false) {
  return core.aggregateDocuments(
    snapshot.documents.map((file) => ({ path: file.path, content: file.content, info: file })),
    { allowStandalone },
  );
}

export async function aggregateSRS(projectPath: StoragePath) {
  return (await aggregateDocuments(await readDocuments(projectPath))).aggregate;
}

export async function readOrderedDocuments(projectPath: StoragePath) {
  const snapshot = await readDocuments(projectPath);
  const project = await aggregateDocuments(snapshot, true);
  return { root: snapshot.root, documents: project.documents };
}
