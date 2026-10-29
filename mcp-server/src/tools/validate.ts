// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { readDocuments } from '../io/documentStorage.js';
import { aggregateDocuments } from '../io/project.js';

export async function handleValidate(projectPath: string, args: { include_files?: boolean }) {
  // Scan for .md files
  const snapshot = await readDocuments(projectPath);
  const files = snapshot.documents;

  if (files.length === 0) {
    return {
      success: false,
      error: 'No .md files found in project directory',
    };
  }

  const project = await aggregateDocuments(snapshot);
  const result = project.aggregate;

  const base = {
    isComplete: result.validation.isComplete,
    errors: result.validation.errors.map((e) => ({
      level: e.level,
      message: e.message,
      path: e.path,
      field: e.field,
      line: e.line,
      column: e.column,
    })),
    warnings: result.validation.warnings.map((w) => ({
      level: w.level,
      message: w.message,
      path: w.path,
      field: w.field,
      line: w.line,
      column: w.column,
    })),
    conflicts: result.validation.conflicts,
    missingFields: result.validation.missingFields,
    fileCount: files.length,
    srsStructure: {
      hasManifest: project.metadata.hasManifest,
      hasProjectOverview: project.metadata.hasProjectOverview,
      hasSystemArchitecture: project.metadata.hasSystemArchitecture,
      hasFunctionalRequirements: project.metadata.hasFunctionalRequirements,
      hasNonFunctionalRequirements: project.metadata.hasNonFunctionalRequirements,
      hasUseCases: project.metadata.hasUseCases,
      hasDomainModel: project.metadata.hasDomainModel,
      hasConstraints: project.metadata.hasConstraints,
      hasDevelopmentImplementation: project.metadata.hasDevelopmentImplementation,
    },
  };

  return {
    success: true,
    result:
      args.include_files === true
        ? {
            ...base,
            files: files.map((f) => ({
              path: f.path,
              name: f.name,
              size: f.size,
              modified: f.modified,
            })),
          }
        : base,
  };
}
