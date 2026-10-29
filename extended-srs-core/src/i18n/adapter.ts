// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Adapter to use generic i18n with Extended SRS specific messages
 */

import {
  getCurrentLocale as getCoreLocale,
  setCurrentLocale as setCoreLocale,
  getMessage,
  MessageContext,
} from '../i18n/core';
import errorMessages from './errorMessages.json';
import { ErrorCode, ErrorContext, getErrorCode } from './errorCodes';

/**
 * Convert ErrorContext to MessageContext
 */
function errorContextToMessageContext(context: ErrorContext): MessageContext {
  const messageContext: MessageContext = {};

  if (context.field !== undefined) {
    messageContext.field = context.field;
  }
  if (context.property !== undefined) {
    messageContext.property = context.property;
  }
  if (context.type !== undefined) {
    messageContext.type = context.type;
  }
  if (context.value !== undefined) {
    messageContext.value = String(context.value);
  }
  if (context.expected !== undefined) {
    messageContext.expected = String(context.expected);
  }
  if (context.limit !== undefined) {
    messageContext.limit = context.limit;
  }
  if (context.pattern !== undefined) {
    messageContext.pattern = context.pattern;
  }
  if (context.allowedValues !== undefined) {
    messageContext.allowedValues = context.allowedValues;
  }
  if (context.schemaTitle !== undefined) {
    messageContext.schemaTitle = context.schemaTitle;
  }

  return messageContext;
}

/**
 * Get current locale (delegates to core)
 */
export const getCurrentLocale = getCoreLocale;

/**
 * Set current locale (delegates to core)
 */
export const setCurrentLocale = setCoreLocale;

/**
 * Get a formatted error message by error code
 */
export function getErrorMessage(errorCode: ErrorCode, context: ErrorContext = {}): string {
  const messageContext = errorContextToMessageContext(context);
  return getMessage(errorMessages as any, errorCode, messageContext);
}

/**
 * Format an error message from AJV error data
 */
export function formatErrorFromData(errorData: any): string {
  if (!errorData || typeof errorData !== 'object') {
    return getErrorMessage(ErrorCode.VALIDATION_ERROR);
  }

  // Get error code
  const errorCode = getErrorCode(errorData);

  // Build context from error data
  const context: ErrorContext = {};

  // Extract field name from instance path
  if (errorData.instancePath) {
    const pathParts = errorData.instancePath.split('/').filter((p: string) => p);
    context.field = pathParts[pathParts.length - 1] || 'unknown';
  }

  // Handle specific error types
  if (errorData.keyword === 'required' && errorData.params?.missingProperty) {
    context.field = errorData.params.missingProperty;
  }

  if (errorData.keyword === 'additionalProperties' && errorData.params?.additionalProperty) {
    context.field = errorData.params.additionalProperty;
  }

  if (errorData.keyword === 'type' && errorData.params?.type) {
    context.expected = errorData.params.type;
  }

  if (errorData.keyword === 'const' && errorData.params?.allowedValue) {
    context.value = errorData.params.allowedValue;
    context.expected = errorData.params.allowedValue;
  }

  if (errorData.keyword === 'enum' && errorData.params?.allowedValues) {
    context.allowedValues = errorData.params.allowedValues;
  }

  if (errorData.keyword === 'pattern' && errorData.params?.pattern) {
    context.pattern = errorData.params.pattern;
  }

  if (
    (errorData.keyword === 'minLength' ||
      errorData.keyword === 'maxLength' ||
      errorData.keyword === 'minimum' ||
      errorData.keyword === 'maximum') &&
    errorData.params?.limit !== undefined
  ) {
    context.limit = errorData.params.limit;
  }

  return getErrorMessage(errorCode, context);
}

/**
 * Get UI message (for QuickFix, etc.)
 */
export function getUIMessage(key: string, context: ErrorContext = {}): string {
  const messageContext = errorContextToMessageContext(context);
  return getMessage(errorMessages as any, key, messageContext);
}
