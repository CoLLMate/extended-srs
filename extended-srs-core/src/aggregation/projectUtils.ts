// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Project Analysis Utility Functions
 *
 * Common utilities for analyzing project structure and metadata
 */

import { findEntryFileFromContributions } from './entryFileUtils';

/**
 * Create metadata summary from aggregated SRS data
 * @param srsData Aggregated SRS data
 * @returns Metadata summary object
 */
export function createMetadataSummary(srsData: any) {
  const detectedSections = new Set<string>();

  // セクションの存在確認（スキーマ定義に準拠）
  const hasManifest = !!srsData?.manifest;
  const hasProjectOverview = !!srsData?.['project-overview'];
  const hasUseCases = !!srsData?.['use-cases'];
  const hasFunctionalRequirements = !!srsData?.['functional-requirements'];
  const hasNonFunctionalRequirements = !!srsData?.['non-functional-requirements'];
  const hasConstraints = !!srsData?.['constraints'];
  const hasSystemArchitecture = !!srsData?.['system-architecture'];
  const hasDevelopmentImplementation = !!srsData?.['development-implementation'];
  const hasDomainModel = !!srsData?.['domain-model'];
  const hasWorkflow = !!srsData?.['workflow'];

  // 全セクションを検出
  if (srsData) {
    Object.keys(srsData).forEach((section) => detectedSections.add(section));
  }

  return {
    hasManifest,
    hasProjectOverview,
    hasUseCases,
    hasFunctionalRequirements,
    hasNonFunctionalRequirements,
    hasConstraints,
    hasSystemArchitecture,
    hasDevelopmentImplementation,
    hasDomainModel,
    hasWorkflow,
    detectedSections: Array.from(detectedSections),
    projectName: srsData?.manifest?.project_name || 'Unknown Project',
    version: srsData?.manifest?.version || null,
  };
}

/**
 * Analyze file structure from aggregated data
 * @param aggregatedData Aggregated data from ExtendedSRSAggregator
 * @param markdownFiles List of markdown file paths
 * @param allFiles List of all file paths
 * @returns File structure analysis
 */
export function analyzeFileStructure(
  aggregatedData: any,
  markdownFiles: string[],
  allFiles: string[],
) {
  const fileDetails = [];

  // すべてのmarkdownファイルを含める
  for (const file of markdownFiles) {
    const contribution = aggregatedData?.contributions?.[file];
    const hasMetadata = contribution && contribution.yamlBlocks?.length > 0;
    const sections = contribution?.srsData ? Object.keys(contribution.srsData) : [];

    fileDetails.push({
      path: file,
      hasMetadata: hasMetadata || false,
      sections,
      yamlBlockCount: contribution?.yamlBlocks?.length || 0,
    });
  }

  // エントリーファイルを特定（統一されたユーティリティを使用）
  let entryFile = null;
  if (aggregatedData?.contributions) {
    entryFile = findEntryFileFromContributions(aggregatedData.contributions);
  }

  // contributionsから見つからない場合はフォールバック
  if (!entryFile) {
    entryFile = markdownFiles[0] || null;
  }

  return {
    entryFile,
    totalFiles: allFiles.length,
    markdownFileCount: markdownFiles.length,
    markdownFiles: fileDetails,
    hasEntryFile: !!entryFile,
  };
}

/**
 * Get project name from aggregated data or content
 * @param aggregatedData Aggregated SRS data
 * @param fileContents Map of file paths to content
 * @returns Project name
 */
export function getProjectName(
  aggregatedData: any,
  fileContents?: Map<string, { content: string }>,
): string {
  // 1. Try from aggregated data
  if (aggregatedData?.srs?.manifest?.project_name) {
    return aggregatedData.srs.manifest.project_name;
  }

  // 2. Try from srs.md file content
  if (fileContents) {
    const entryFile = Array.from(fileContents.keys()).find(
      (f) => f === 'srs.md' || f.endsWith('/srs.md'),
    );

    if (entryFile) {
      const content = fileContents.get(entryFile)?.content;
      if (content) {
        const manifestMatch = content.match(/manifest:\s*\n\s*.*project_name:\s*["']?([^"'\n]+)/);
        if (manifestMatch) {
          return manifestMatch[1];
        }
      }
    }
  }

  return 'Unknown Project';
}

/**
 * Check if project has required implementation sections
 * @param srsData Aggregated SRS data
 * @returns Boolean indicating if implementation sections exist
 */
export function hasImplementationSections(srsData: any): boolean {
  return !!(
    srsData?.['system-architecture'] ||
    srsData?.['functional-requirements'] ||
    srsData?.['development-implementation']
  );
}

/**
 * Get recommended sections that are missing
 * @param srsData Aggregated SRS data
 * @returns List of recommended but missing sections
 */
export function getMissingSections(srsData: any): string[] {
  const recommendedSections = [
    'manifest',
    'project-overview',
    'use-cases',
    'functional-requirements',
    'non-functional-requirements',
    'constraints',
    'system-architecture',
    'development-implementation',
    'domain-model',
    'workflow',
  ];

  const missing = [];
  for (const section of recommendedSections) {
    if (!srsData?.[section]) {
      missing.push(section);
    }
  }

  return missing;
}

/**
 * Create project status summary
 * @param aggregatedData Aggregated data
 * @param validationResult Validation result
 * @param fileContents File contents map
 * @param markdownFiles List of markdown files
 * @param allFiles List of all files
 * @returns Complete project status
 */
export function createProjectStatus(
  aggregatedData: any,
  _validationResult: any,
  fileContents: Map<string, { content: string }>,
  markdownFiles: string[],
  allFiles: string[],
) {
  const metadataSummary = createMetadataSummary(aggregatedData?.srs);
  const fileStructure = analyzeFileStructure(aggregatedData, markdownFiles, allFiles);
  const projectName = getProjectName(aggregatedData, fileContents);

  return {
    projectName,
    metadataSummary,
    fileStructure,
    hasImplementation: hasImplementationSections(aggregatedData?.srs),
    missingSections: getMissingSections(aggregatedData?.srs),
  };
}
