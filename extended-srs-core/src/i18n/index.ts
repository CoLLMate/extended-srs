// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Universal i18n Module
 *
 * Provides internationalization support for the entire application
 */

export type { Locale, LocaleProvider, MessageContext, MessageBundle } from './core';

export {
  setLocaleProvider,
  getCurrentLocale,
  setCurrentLocale,
  getAvailableLocales,
  isLocaleSupported,
  formatTemplate,
  getMessage,
} from './core';

export { formatErrorFromData, getUIMessage, getErrorMessage } from './adapter';

export { ErrorCode, getErrorCode } from './errorCodes';
