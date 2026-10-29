// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  findEntryFileFromContributions,
  isEntryFile,
  getEntryFileRequirements,
  createEntryFileNotFoundError,
  createMissingSectionError,
} from '../src';

describe('entryFileUtils', () => {
  describe('findEntryFileFromContributions', () => {
    it('should find srs.md as entry file when it exists', () => {
      const contributions = {
        'srs.md': { srsData: { manifest: { project_name: 'Test' } } },
        'other.md': { srsData: {} },
      };

      const result = findEntryFileFromContributions(contributions);
      expect(result).toBe('srs.md');
    });

    it('should find nested srs.md as entry file', () => {
      const contributions = {
        'docs/srs.md': { srsData: { manifest: { project_name: 'Test' } } },
        'other.md': { srsData: {} },
      };

      const result = findEntryFileFromContributions(contributions);
      expect(result).toBe('docs/srs.md');
    });

    it('should return null when srs.md does not exist (v1.0.4: srs.md is required)', () => {
      const contributions = {
        'README.md': { srsData: { manifest: { project_name: 'Test' } } },
        'other.md': { srsData: {} },
      };

      const result = findEntryFileFromContributions(contributions);
      expect(result).toBeNull(); // srs.md is required per v1.0.4 spec
    });

    it('should return null when no entry file exists', () => {
      const contributions = {
        'doc1.md': { srsData: { 'use-cases': {} } },
        'doc2.md': { srsData: { 'system-architecture': {} } },
      };

      const result = findEntryFileFromContributions(contributions);
      expect(result).toBeNull();
    });

    it('should prioritize srs.md over files with manifest', () => {
      const contributions = {
        'README.md': { srsData: { manifest: { project_name: 'Test' } } },
        'srs.md': { srsData: {} },
        'other.md': { srsData: { manifest: { project_name: 'Other' } } },
      };

      const result = findEntryFileFromContributions(contributions);
      expect(result).toBe('srs.md');
    });
  });

  describe('isEntryFile', () => {
    it('should identify srs.md as entry file', () => {
      expect(isEntryFile('srs.md')).toBe(true);
      expect(isEntryFile('docs/srs.md')).toBe(true);
      expect(isEntryFile('/project/srs.md')).toBe(true);
    });

    it('should not identify file with manifest as entry file (v1.0.4: only srs.md)', () => {
      // hasManifest parameter is deprecated in v1.0.4
      expect(isEntryFile('README.md', true)).toBe(false);
      expect(isEntryFile('index.md', true)).toBe(false);
    });

    it('should not identify regular files as entry file', () => {
      expect(isEntryFile('README.md', false)).toBe(false);
      expect(isEntryFile('doc.md', false)).toBe(false);
      expect(isEntryFile('srs-other.md', false)).toBe(false);
    });
  });

  describe('getEntryFileRequirements', () => {
    it('should return required sections for entry file', () => {
      const requirements = getEntryFileRequirements();
      expect(requirements).toEqual(['manifest']);
      expect(requirements).toContain('manifest');
    });
  });

  describe('createEntryFileNotFoundError', () => {
    it('should create proper error object for missing entry file', () => {
      const error = createEntryFileNotFoundError();

      expect(error).toEqual({
        level: 'error',
        message: 'エントリーファイル(srs.md)が見つかりません',
        path: '',
        line: 0,
        column: 0,
      });
    });
  });

  describe('createMissingSectionError', () => {
    it('should create proper error object for missing section', () => {
      const error = createMissingSectionError('manifest', 'srs.md');

      expect(error).toEqual({
        level: 'error',
        message: '必須のトップレベルセクション "manifest" が見つかりません',
        path: 'srs.md',
        line: 0,
        column: 0,
      });
    });

    it('should handle different section names', () => {
      const error = createMissingSectionError('project-overview', 'README.md');

      expect(error.message).toContain('project-overview');
      expect(error.path).toBe('README.md');
    });
  });
});
