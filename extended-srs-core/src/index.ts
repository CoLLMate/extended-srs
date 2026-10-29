// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
// Extended SRS Core exports

// Types
export * from './types';

// Validation
export * from './validation/validator';
export {
  groupValidationResultsByFile,
  formatValidationMessage,
  groupValidationResultsAsObject,
  filterBySeverity,
  getUniqueFilePaths,
  countBySeverity,
  sortValidationResults,
  createValidationSummary,
} from './validation/validationUtils';

// Parsing
export * from './parsing/yamlParser';

// Schema
export * from './schema/schemaLoader';

// Aggregation
export * from './aggregation/aggregator';
// ValidationService removed - use Aggregator directly
// Export individual types from aggregator
export type {
  ExtendedSRSContribution,
  ExtendedSRSValidationError,
  ExtendedSRSValidationWarning,
  ExtendedSRSConflict,
} from './aggregation/aggregator';

// Extended SRS Tree exports (統合)
export * from './tree/treeTypes';
export * from './tree/parser';
export * from './tree/manager';

// Project analysis exports (now in aggregation)
export * from './aggregation/projectUtils';
export * from './aggregation/entryFileUtils';

// i18n exports
export * from './i18n';

// Schema-defined lifecycle, dependencies and review policy (no Node.js I/O).
export * from './rules/errors';
export * from './rules/elementSearch';
export * from './rules/project';
export * from './rules/workflow';
export * from './rules/reviews';
export * from './rules/lifecycle';
export * from './rules/documents';
