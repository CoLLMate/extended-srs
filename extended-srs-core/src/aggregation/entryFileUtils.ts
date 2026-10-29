// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Entry File Utility Functions
 *
 * Common utilities for finding and managing entry files in Extended SRS projects
 */

/**
 * Find entry file from aggregated data contributions
 * Extended SRS v1.0.4仕様により、srs.mdが必須
 * @param contributions Contributions object from AggregatedExtendedSRS
 * @returns Entry file path or null
 */
export function findEntryFileFromContributions(contributions: {
  [filePath: string]: any;
}): string | null {
  // srs.md is required per Extended SRS v1.0.4 spec
  const srsFile = Object.keys(contributions).find(
    (path) => path === 'srs.md' || path.endsWith('/srs.md'),
  );

  return srsFile || null;
}

/**
 * Check if a file is an entry file
 * Extended SRS v1.0.4仕様により、srs.mdのみがエントリーファイル
 * @param filePath File path to check
 * @param _hasManifest Deprecated - no longer used
 * @returns Boolean indicating if it's an entry file
 */
export function isEntryFile(filePath: string, _hasManifest: boolean = false): boolean {
  // srs.md is the only valid entry file per Extended SRS v1.0.4 spec
  return filePath === 'srs.md' || filePath.endsWith('/srs.md');
}

/**
 * Get entry file requirements
 * @returns Array of required sections for entry file
 */
export function getEntryFileRequirements(): string[] {
  return ['manifest'];
}

/**
 * Create entry file not found error
 * @returns Validation error object
 */
export function createEntryFileNotFoundError() {
  return {
    level: 'error' as const,
    message: 'エントリーファイル(srs.md)が見つかりません',
    path: '',
    line: 0,
    column: 0,
  };
}

/**
 * Create missing required section error
 * @param section Missing section name
 * @param filePath File path
 * @returns Validation error object
 */
export function createMissingSectionError(section: string, filePath: string) {
  return {
    level: 'error' as const,
    message: `必須のトップレベルセクション "${section}" が見つかりません`,
    path: filePath,
    line: 0,
    column: 0,
  };
}
