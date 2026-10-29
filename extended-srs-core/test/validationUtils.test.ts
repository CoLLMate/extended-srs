// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  groupValidationResultsByFile,
  formatValidationMessage,
  groupValidationResultsAsObject,
  filterBySeverity,
  getUniqueFilePaths,
  countBySeverity,
  sortValidationResults,
  createValidationSummary,
} from '../src';

// ValidationResult type (from frontend types)
interface ValidationResult {
  level: 'error' | 'warning' | 'info';
  message: string;
  path: string;
  line?: number;
  column?: number;
}

describe('validationUtils', () => {
  const sampleValidationResults: ValidationResult[] = [
    {
      level: 'error',
      message: 'Missing required field',
      path: 'srs.md',
      line: 10,
      column: 5,
    },
    {
      level: 'warning',
      message: 'Deprecated field used',
      path: 'srs.md',
      line: 20,
      column: 3,
    },
    {
      level: 'error',
      message: 'Invalid format',
      path: 'features.md',
      line: 5,
      column: 1,
    },
    {
      level: 'warning',
      message: 'Consider using new syntax',
      path: 'features.md',
      line: 15,
      column: 2,
    },
    {
      level: 'error',
      message: 'Project-level error',
      path: '',
      line: 0,
      column: 0,
    },
  ];

  describe('groupValidationResultsByFile', () => {
    it('should group validation results by file path', () => {
      const grouped = groupValidationResultsByFile(sampleValidationResults);

      expect(grouped.size).toBe(3);
      expect(grouped.has('srs.md')).toBe(true);
      expect(grouped.has('features.md')).toBe(true);
      expect(grouped.has('[プロジェクト全体]')).toBe(true);

      const srsErrors = grouped.get('srs.md');
      expect(srsErrors).toHaveLength(2);
      expect(srsErrors![0]).toContain('Line 10');
      expect(srsErrors![1]).toContain('Line 20');
    });

    it('should handle empty results', () => {
      const grouped = groupValidationResultsByFile([]);
      expect(grouped.size).toBe(0);
    });

    it('should handle results without path', () => {
      const results: ValidationResult[] = [
        { level: 'error', message: 'Error 1', path: '', line: 0 },
        { level: 'error', message: 'Error 2', path: '', line: 0 },
      ];

      const grouped = groupValidationResultsByFile(results);
      expect(grouped.has('[プロジェクト全体]')).toBe(true);
      expect(grouped.get('[プロジェクト全体]')).toHaveLength(2);
    });
  });

  describe('formatValidationMessage', () => {
    it('should format validation message with file path', () => {
      const result: ValidationResult = {
        level: 'error',
        message: 'Test error',
        path: 'test.md',
        line: 10,
      };

      const formatted = formatValidationMessage(result);
      expect(formatted).toBe('[test.md] Line 10: Test error');
    });

    it('should format validation message without file path', () => {
      const result: ValidationResult = {
        level: 'error',
        message: 'Global error',
        path: '',
        line: 0,
      };

      const formatted = formatValidationMessage(result);
      expect(formatted).toBe('[プロジェクト全体] Line 0: Global error');
    });
  });

  describe('groupValidationResultsAsObject', () => {
    it('should return object with grouped results', () => {
      const grouped = groupValidationResultsAsObject(sampleValidationResults);

      expect(Object.keys(grouped)).toHaveLength(3);
      expect(grouped['srs.md']).toHaveLength(2);
      expect(grouped['features.md']).toHaveLength(2);
      expect(grouped['[プロジェクト全体]']).toHaveLength(1);
    });
  });

  describe('filterBySeverity', () => {
    it('should filter errors', () => {
      const errors = filterBySeverity(sampleValidationResults, 'error');
      expect(errors).toHaveLength(3);
      expect(errors.every((r) => r.level === 'error')).toBe(true);
    });

    it('should filter warnings', () => {
      const warnings = filterBySeverity(sampleValidationResults, 'warning');
      expect(warnings).toHaveLength(2);
      expect(warnings.every((r) => r.level === 'warning')).toBe(true);
    });
  });

  describe('getUniqueFilePaths', () => {
    it('should get unique file paths excluding project level by default', () => {
      const paths = getUniqueFilePaths(sampleValidationResults);
      expect(paths).toEqual(['srs.md', 'features.md']);
    });

    it('should include project level when specified', () => {
      const paths = getUniqueFilePaths(sampleValidationResults, false);
      expect(paths).toContain('[プロジェクト全体]');
      expect(paths).toHaveLength(3);
    });

    it('should handle empty results', () => {
      const paths = getUniqueFilePaths([]);
      expect(paths).toEqual([]);
    });

    it('should handle duplicate paths', () => {
      const results: ValidationResult[] = [
        { level: 'error', message: 'Error 1', path: 'test.md', line: 1 },
        { level: 'error', message: 'Error 2', path: 'test.md', line: 2 },
        { level: 'error', message: 'Error 3', path: 'test.md', line: 3 },
      ];

      const paths = getUniqueFilePaths(results);
      expect(paths).toEqual(['test.md']);
    });
  });

  describe('countBySeverity', () => {
    it('should count errors and warnings', () => {
      const count = countBySeverity(sampleValidationResults);
      expect(count.errors).toBe(3);
      expect(count.warnings).toBe(2);
    });

    it('should handle empty results', () => {
      const count = countBySeverity([]);
      expect(count.errors).toBe(0);
      expect(count.warnings).toBe(0);
    });

    it('should handle only errors', () => {
      const results: ValidationResult[] = [
        { level: 'error', message: 'Error 1', path: '', line: 0 },
        { level: 'error', message: 'Error 2', path: '', line: 0 },
      ];

      const count = countBySeverity(results);
      expect(count.errors).toBe(2);
      expect(count.warnings).toBe(0);
    });
  });

  describe('sortValidationResults', () => {
    it('should sort by file path then line number', () => {
      const unsorted: ValidationResult[] = [
        { level: 'error', message: 'E1', path: 'b.md', line: 10 },
        { level: 'error', message: 'E2', path: 'a.md', line: 20 },
        { level: 'error', message: 'E3', path: 'b.md', line: 5 },
        { level: 'error', message: 'E4', path: 'a.md', line: 10 },
      ];

      const sorted = sortValidationResults(unsorted);

      expect(sorted[0].path).toBe('a.md');
      expect(sorted[0].line).toBe(10);
      expect(sorted[1].path).toBe('a.md');
      expect(sorted[1].line).toBe(20);
      expect(sorted[2].path).toBe('b.md');
      expect(sorted[2].line).toBe(5);
      expect(sorted[3].path).toBe('b.md');
      expect(sorted[3].line).toBe(10);
    });

    it('should handle missing paths and lines', () => {
      const unsorted: ValidationResult[] = [
        { level: 'error', message: 'E1', path: 'a.md', line: 0 },
        { level: 'error', message: 'E2', path: '', line: 0 },
        { level: 'error', message: 'E3', path: 'b.md', line: 5 },
      ];

      const sorted = sortValidationResults(unsorted);
      expect(sorted[0].path).toBe('');
      expect(sorted[1].path).toBe('a.md');
      expect(sorted[2].path).toBe('b.md');
    });
  });

  describe('createValidationSummary', () => {
    it('should create complete validation summary', () => {
      const summary = createValidationSummary(sampleValidationResults);

      expect(summary.totalIssues).toBe(5);
      expect(summary.errorCount).toBe(3);
      expect(summary.warningCount).toBe(2);
      expect(summary.filesWithErrors).toEqual(['srs.md', 'features.md']);
      expect(summary.filesWithWarnings).toEqual(['srs.md', 'features.md']);
      expect(summary.hasErrors).toBe(true);
      expect(summary.hasWarnings).toBe(true);
      expect(summary.isValid).toBe(false);
    });

    it('should handle no errors', () => {
      const warnings: ValidationResult[] = [
        { level: 'warning', message: 'W1', path: 'test.md', line: 1 },
        { level: 'warning', message: 'W2', path: 'test.md', line: 2 },
      ];

      const summary = createValidationSummary(warnings);

      expect(summary.errorCount).toBe(0);
      expect(summary.warningCount).toBe(2);
      expect(summary.hasErrors).toBe(false);
      expect(summary.hasWarnings).toBe(true);
      expect(summary.isValid).toBe(true);
    });

    it('should handle empty results', () => {
      const summary = createValidationSummary([]);

      expect(summary.totalIssues).toBe(0);
      expect(summary.errorCount).toBe(0);
      expect(summary.warningCount).toBe(0);
      expect(summary.filesWithErrors).toEqual([]);
      expect(summary.filesWithWarnings).toEqual([]);
      expect(summary.hasErrors).toBe(false);
      expect(summary.hasWarnings).toBe(false);
      expect(summary.isValid).toBe(true);
    });
  });
});
