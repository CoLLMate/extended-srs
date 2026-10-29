// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  createMetadataSummary,
  analyzeFileStructure,
  getProjectName,
  hasImplementationSections,
  getMissingSections,
} from '../src';

describe('projectUtils', () => {
  describe('createMetadataSummary', () => {
    it('should create summary from complete SRS data', () => {
      const srsData = {
        manifest: { project_name: 'Test Project', version: '1.0.0' },
        'project-overview': { objective: 'Test objective' },
        'use-cases': {},
        'functional-requirements': {},
        'non-functional-requirements': {},
        constraints: {},
        'system-architecture': {},
        'development-implementation': {},
        'domain-model': {},
        workflow: {},
      };

      const summary = createMetadataSummary(srsData);

      expect(summary.hasManifest).toBe(true);
      expect(summary.hasProjectOverview).toBe(true);
      expect(summary.hasUseCases).toBe(true);
      expect(summary.hasFunctionalRequirements).toBe(true);
      expect(summary.hasNonFunctionalRequirements).toBe(true);
      expect(summary.hasConstraints).toBe(true);
      expect(summary.hasSystemArchitecture).toBe(true);
      expect(summary.hasDevelopmentImplementation).toBe(true);
      expect(summary.hasDomainModel).toBe(true);
      expect(summary.hasWorkflow).toBe(true);
      expect(summary.projectName).toBe('Test Project');
      expect(summary.version).toBe('1.0.0');
      expect(summary.detectedSections).toHaveLength(10);
    });

    it('should handle partial SRS data', () => {
      const srsData = {
        manifest: { project_name: 'Partial Project' },
        'project-overview': {},
      };

      const summary = createMetadataSummary(srsData);

      expect(summary.hasManifest).toBe(true);
      expect(summary.hasProjectOverview).toBe(true);
      expect(summary.hasUseCases).toBe(false);
      expect(summary.hasSystemArchitecture).toBe(false);
      expect(summary.hasNonFunctionalRequirements).toBe(false);
      expect(summary.hasConstraints).toBe(false);
      expect(summary.hasDomainModel).toBe(false);
      expect(summary.hasWorkflow).toBe(false);
      expect(summary.projectName).toBe('Partial Project');
      expect(summary.version).toBeNull();
      expect(summary.detectedSections).toEqual(['manifest', 'project-overview']);
    });

    it('should handle empty SRS data', () => {
      const summary = createMetadataSummary(null);

      expect(summary.hasManifest).toBe(false);
      expect(summary.hasProjectOverview).toBe(false);
      expect(summary.projectName).toBe('Unknown Project');
      expect(summary.detectedSections).toEqual([]);
    });
  });

  describe('analyzeFileStructure', () => {
    it('should analyze file structure with aggregated data', () => {
      const aggregatedData = {
        srs: { manifest: { project_name: 'Test' } },
        contributions: {
          'srs.md': {
            yamlBlocks: [{}],
            srsData: { manifest: {} },
          },
          'features.md': {
            yamlBlocks: [{}, {}],
            srsData: { 'use-cases': {}, 'functional-requirements': {} },
          },
        },
      };
      const markdownFiles = ['srs.md', 'features.md'];
      const allFiles = ['srs.md', 'features.md', 'package.json', 'README.md'];

      const result = analyzeFileStructure(aggregatedData, markdownFiles, allFiles);

      expect(result.entryFile).toBe('srs.md');
      expect(result.totalFiles).toBe(4);
      expect(result.markdownFileCount).toBe(2);
      expect(result.hasEntryFile).toBe(true);
      expect(result.markdownFiles).toHaveLength(2);
      expect(result.markdownFiles[0]).toEqual({
        path: 'srs.md',
        hasMetadata: true,
        sections: ['manifest'],
        yamlBlockCount: 1,
      });
      expect(result.markdownFiles[1]).toEqual({
        path: 'features.md',
        hasMetadata: true,
        sections: ['use-cases', 'functional-requirements'],
        yamlBlockCount: 2,
      });
    });

    it('should find entry file with manifest when srs.md does not exist', () => {
      const aggregatedData = {
        srs: { manifest: { project_name: 'Test' } },
        contributions: {
          'README.md': {
            yamlBlocks: [{}],
            srsData: { manifest: {} },
          },
        },
      };
      const markdownFiles = ['README.md', 'other.md'];
      const allFiles = ['README.md', 'other.md'];

      const result = analyzeFileStructure(aggregatedData, markdownFiles, allFiles);

      expect(result.entryFile).toBe('README.md');
      expect(result.hasEntryFile).toBe(true);
    });

    it('should handle no aggregated data', () => {
      const markdownFiles = ['doc1.md', 'doc2.md'];
      const allFiles = ['doc1.md', 'doc2.md', 'index.js'];

      const result = analyzeFileStructure(null, markdownFiles, allFiles);

      expect(result.entryFile).toBe('doc1.md');
      expect(result.totalFiles).toBe(3);
      expect(result.markdownFileCount).toBe(2);
      expect(result.markdownFiles).toEqual([
        { path: 'doc1.md', hasMetadata: false, sections: [], yamlBlockCount: 0 },
        { path: 'doc2.md', hasMetadata: false, sections: [], yamlBlockCount: 0 },
      ]);
    });
  });

  describe('getProjectName', () => {
    it('should get project name from aggregated data', () => {
      const aggregatedData = {
        srs: {
          manifest: { project_name: 'My Project' },
        },
      };

      const name = getProjectName(aggregatedData);
      expect(name).toBe('My Project');
    });

    it('should get project name from file contents', () => {
      const aggregatedData = { srs: {} };
      const fileContents = new Map([
        ['srs.md', { content: '<!-- @srs\nmanifest:\n  project_name: "Content Project"\n-->' }],
      ]);

      const name = getProjectName(aggregatedData, fileContents);
      expect(name).toBe('Content Project');
    });

    it('should return default name when not found', () => {
      const name = getProjectName({});
      expect(name).toBe('Unknown Project');
    });
  });

  describe('hasImplementationSections', () => {
    it('should return true when implementation sections exist', () => {
      const srsData = {
        'system-architecture': {},
        'functional-requirements': {},
      };

      expect(hasImplementationSections(srsData)).toBe(true);
    });

    it('should return true for development-implementation section', () => {
      const srsData = {
        'development-implementation': {},
      };

      expect(hasImplementationSections(srsData)).toBe(true);
    });

    it('should return false when no implementation sections exist', () => {
      const srsData = {
        manifest: {},
        'project-overview': {},
      };

      expect(hasImplementationSections(srsData)).toBe(false);
    });
  });

  describe('getMissingSections', () => {
    it('should return empty array when all sections exist', () => {
      const srsData = {
        manifest: {},
        'project-overview': {},
        'use-cases': {},
        'functional-requirements': {},
        'non-functional-requirements': {},
        constraints: {},
        'system-architecture': {},
        'development-implementation': {},
        'domain-model': {},
        workflow: {},
      };

      const missing = getMissingSections(srsData);
      expect(missing).toEqual([]);
    });

    it('should return missing sections', () => {
      const srsData = {
        manifest: {},
        'project-overview': {},
      };

      const missing = getMissingSections(srsData);
      expect(missing).toContain('use-cases');
      expect(missing).toContain('functional-requirements');
      expect(missing).toContain('non-functional-requirements');
      expect(missing).toContain('constraints');
      expect(missing).toContain('system-architecture');
      expect(missing).toContain('development-implementation');
      expect(missing).toContain('domain-model');
      expect(missing).toContain('workflow');
      expect(missing).not.toContain('manifest');
      expect(missing).not.toContain('project-overview');
    });

    it('should return all sections when data is empty', () => {
      const missing = getMissingSections({});
      expect(missing).toHaveLength(10);
      expect(missing).toContain('manifest');
    });
  });
});
