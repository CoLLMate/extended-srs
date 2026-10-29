// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Validation Utility Functions
 *
 * Common utilities for processing and formatting validation results
 */

import { ValidationResult } from '../types';

/**
 * Group validation results by file path
 * @param validationResults Array of validation results
 * @returns Map of file paths to their validation messages
 */
export function groupValidationResultsByFile(
  validationResults: ValidationResult[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const result of validationResults) {
    const file = result.path || '[プロジェクト全体]';
    if (!grouped.has(file)) {
      grouped.set(file, []);
    }
    grouped.get(file)!.push(`Line ${result.line}: ${result.message}`);
  }

  return grouped;
}

/**
 * Format a validation result for display
 * @param result Validation result
 * @returns Formatted message string
 */
export function formatValidationMessage(result: ValidationResult): string {
  const filePrefix = result.path ? `[${result.path}]` : '[プロジェクト全体]';
  return `${filePrefix} Line ${result.line}: ${result.message}`;
}

/**
 * Group validation results by file and return as object
 * @param validationResults Array of validation results
 * @returns Object with file paths as keys and message arrays as values
 */
export function groupValidationResultsAsObject(
  validationResults: ValidationResult[],
): Record<string, string[]> {
  const grouped = groupValidationResultsByFile(validationResults);
  return Object.fromEntries(grouped);
}

/**
 * Filter validation results by severity
 * @param validationResults Array of validation results
 * @param severity Severity level to filter by
 * @returns Filtered validation results
 */
export function filterBySeverity(
  validationResults: ValidationResult[],
  severity: 'error' | 'warning',
): ValidationResult[] {
  return validationResults.filter((result) => result.level === severity);
}

/**
 * Get unique file paths from validation results
 * @param validationResults Array of validation results
 * @param excludeProjectLevel Whether to exclude project-level errors
 * @returns Array of unique file paths
 */
export function getUniqueFilePaths(
  validationResults: ValidationResult[],
  excludeProjectLevel: boolean = true,
): string[] {
  const paths = new Set<string>();

  for (const result of validationResults) {
    if (result.path) {
      paths.add(result.path);
    } else if (!excludeProjectLevel) {
      paths.add('[プロジェクト全体]');
    }
  }

  return Array.from(paths);
}

/**
 * Count validation results by severity
 * @param validationResults Array of validation results
 * @returns Object with error and warning counts
 */
export function countBySeverity(validationResults: ValidationResult[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;

  for (const result of validationResults) {
    if (result.level === 'error') {
      errors++;
    } else if (result.level === 'warning') {
      warnings++;
    }
  }

  return { errors, warnings };
}

/**
 * Sort validation results by file path and line number
 * @param validationResults Array of validation results
 * @returns Sorted array of validation results
 */
export function sortValidationResults(validationResults: ValidationResult[]): ValidationResult[] {
  return [...validationResults].sort((a, b) => {
    // First sort by file path
    const pathA = a.path || '';
    const pathB = b.path || '';
    const pathCompare = pathA.localeCompare(pathB);

    if (pathCompare !== 0) {
      return pathCompare;
    }

    // Then sort by line number
    return (a.line || 0) - (b.line || 0);
  });
}

/**
 * Create a summary of validation results
 * @param validationResults Array of validation results
 * @returns Summary object
 */
export function createValidationSummary(validationResults: ValidationResult[]) {
  const errors = filterBySeverity(validationResults, 'error');
  const warnings = filterBySeverity(validationResults, 'warning');

  return {
    totalIssues: validationResults.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    filesWithErrors: getUniqueFilePaths(errors),
    filesWithWarnings: getUniqueFilePaths(warnings),
    hasErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
    isValid: errors.length === 0,
  };
}
