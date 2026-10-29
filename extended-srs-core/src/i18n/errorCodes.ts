// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Error codes for Extended SRS validation
 *
 * These codes are used to identify specific validation errors
 * and map them to localized messages
 */

export enum ErrorCode {
  // Required field errors
  REQUIRED_FIELD = 'SRS_REQUIRED_FIELD',
  REQUIRED_MANIFEST = 'SRS_REQUIRED_MANIFEST',
  REQUIRED_FORMAT = 'SRS_REQUIRED_FORMAT',
  REQUIRED_VERSION = 'SRS_REQUIRED_VERSION',

  // Type errors
  TYPE_MISMATCH = 'SRS_TYPE_MISMATCH',
  TYPE_STRING_EXPECTED = 'SRS_TYPE_STRING_EXPECTED',
  TYPE_NUMBER_EXPECTED = 'SRS_TYPE_NUMBER_EXPECTED',
  TYPE_BOOLEAN_EXPECTED = 'SRS_TYPE_BOOLEAN_EXPECTED',
  TYPE_OBJECT_EXPECTED = 'SRS_TYPE_OBJECT_EXPECTED',
  TYPE_ARRAY_EXPECTED = 'SRS_TYPE_ARRAY_EXPECTED',

  // Format errors
  FORMAT_INVALID = 'SRS_FORMAT_INVALID',
  FORMAT_DATE_INVALID = 'SRS_FORMAT_DATE_INVALID',
  FORMAT_EMAIL_INVALID = 'SRS_FORMAT_EMAIL_INVALID',
  FORMAT_URL_INVALID = 'SRS_FORMAT_URL_INVALID',
  FORMAT_UUID_INVALID = 'SRS_FORMAT_UUID_INVALID',

  // Constraint errors
  ENUM_INVALID = 'SRS_ENUM_INVALID',
  PATTERN_INVALID = 'SRS_PATTERN_INVALID',
  MIN_LENGTH = 'SRS_MIN_LENGTH',
  MAX_LENGTH = 'SRS_MAX_LENGTH',
  MINIMUM_VALUE = 'SRS_MINIMUM_VALUE',
  MAXIMUM_VALUE = 'SRS_MAXIMUM_VALUE',

  // Schema errors
  ADDITIONAL_PROPERTY = 'SRS_ADDITIONAL_PROPERTY',
  INVALID_SCHEMA = 'SRS_INVALID_SCHEMA',

  // Specific field errors
  MANIFEST_FORMAT_INVALID = 'SRS_MANIFEST_FORMAT_INVALID',
  VERSION_FORMAT_INVALID = 'SRS_VERSION_FORMAT_INVALID',
  TIMESTAMP_INVALID = 'SRS_TIMESTAMP_INVALID',

  // Generic error
  VALIDATION_ERROR = 'SRS_VALIDATION_ERROR',
}

/**
 * Map AJV error to our error code
 */
export function getErrorCode(error: {
  keyword: string;
  instancePath?: string;
  params?: any;
  schemaPath?: string;
}): ErrorCode {
  const { keyword, instancePath, params } = error;

  // Special cases for specific fields
  if (keyword === 'required') {
    const missingProp = params?.missingProperty;
    if (missingProp === 'manifest') {
      return ErrorCode.REQUIRED_MANIFEST;
    }
    if (missingProp === 'format') {
      return ErrorCode.REQUIRED_FORMAT;
    }
    if (missingProp === 'version') {
      return ErrorCode.REQUIRED_VERSION;
    }
    return ErrorCode.REQUIRED_FIELD;
  }

  if (keyword === 'type') {
    const expectedType = params?.type;
    switch (expectedType) {
      case 'string':
        return ErrorCode.TYPE_STRING_EXPECTED;
      case 'number':
        return ErrorCode.TYPE_NUMBER_EXPECTED;
      case 'integer':
        return ErrorCode.TYPE_NUMBER_EXPECTED;
      case 'boolean':
        return ErrorCode.TYPE_BOOLEAN_EXPECTED;
      case 'object':
        return ErrorCode.TYPE_OBJECT_EXPECTED;
      case 'array':
        return ErrorCode.TYPE_ARRAY_EXPECTED;
      default:
        return ErrorCode.TYPE_MISMATCH;
    }
  }

  if (keyword === 'format') {
    const format = params?.format;
    switch (format) {
      case 'date':
      case 'date-time':
        return ErrorCode.FORMAT_DATE_INVALID;
      case 'email':
        return ErrorCode.FORMAT_EMAIL_INVALID;
      case 'uri':
      case 'url':
        return ErrorCode.FORMAT_URL_INVALID;
      case 'uuid':
        return ErrorCode.FORMAT_UUID_INVALID;
      default:
        return ErrorCode.FORMAT_INVALID;
    }
  }

  if (keyword === 'const') {
    // Special case for manifest format
    if (instancePath?.includes('/manifest/format')) {
      return ErrorCode.MANIFEST_FORMAT_INVALID;
    }
  }

  // Map other keywords
  switch (keyword) {
    case 'enum':
      return ErrorCode.ENUM_INVALID;
    case 'pattern':
      return ErrorCode.PATTERN_INVALID;
    case 'minLength':
      return ErrorCode.MIN_LENGTH;
    case 'maxLength':
      return ErrorCode.MAX_LENGTH;
    case 'minimum':
      return ErrorCode.MINIMUM_VALUE;
    case 'maximum':
      return ErrorCode.MAXIMUM_VALUE;
    case 'additionalProperties':
      return ErrorCode.ADDITIONAL_PROPERTY;
    default:
      return ErrorCode.VALIDATION_ERROR;
  }
}

/**
 * Error context for providing additional information
 */
export interface ErrorContext {
  field?: string;
  property?: string; // For QuickFix messages
  type?: string; // For type error messages
  value?: any;
  expected?: any;
  limit?: number;
  pattern?: string;
  allowedValues?: string[];
  schemaTitle?: string;
}
