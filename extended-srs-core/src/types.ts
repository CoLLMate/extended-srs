// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS Core Types
 *
 * Common type definitions used throughout the extended-srs-core package
 */

/**
 * File information interface
 */
export interface FileInfo {
  path: string;
  name: string;
  is_directory: boolean;
  is_submodule?: boolean;
  size: number;
  modified: string;
}

/**
 * Validation result interface (used by utils)
 */
export interface ValidationResult {
  level: 'error' | 'warning' | 'info';
  path: string;
  message: string;
  line?: number;
  column?: number;
}
