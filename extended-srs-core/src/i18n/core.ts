// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Universal i18n Core Module
 *
 * Provides internationalization support for the entire application
 * Can be used in both frontend and backend environments
 */

export type Locale = 'en' | 'ja';

/**
 * Interface for locale provider
 * Different environments can implement this differently
 */
export interface LocaleProvider {
  getCurrentLocale(): Locale;
  setCurrentLocale?(locale: Locale): void;
}

/**
 * Default locale provider for Node.js environment
 */
class DefaultLocaleProvider implements LocaleProvider {
  private locale: Locale = 'en';

  getCurrentLocale(): Locale {
    // Check environment variable first
    const envLocale =
      typeof process === 'undefined' ? undefined : process.env?.SRS_LOCALE || process.env?.LANG;
    if (envLocale?.startsWith('ja')) {
      return 'ja';
    }
    return this.locale;
  }

  setCurrentLocale(locale: Locale): void {
    this.locale = locale;
  }
}

/**
 * Browser locale provider
 */
class BrowserLocaleProvider implements LocaleProvider {
  getCurrentLocale(): Locale {
    if (typeof window !== 'undefined') {
      // Check for stored preference
      const stored = localStorage.getItem('app-locale');
      if (stored === 'ja' || stored === 'en') {
        return stored;
      }

      // Fall back to browser language
      const lang = window.navigator.language.toLowerCase();
      if (lang.startsWith('ja')) {
        return 'ja';
      }
    }
    return 'en';
  }

  setCurrentLocale(locale: Locale): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('app-locale', locale);
    }
  }
}

// Global locale provider instance
let localeProvider: LocaleProvider;

/**
 * Initialize the locale provider based on environment
 */
function initializeLocaleProvider(): LocaleProvider {
  if (!localeProvider) {
    if (typeof window !== 'undefined') {
      localeProvider = new BrowserLocaleProvider();
    } else {
      localeProvider = new DefaultLocaleProvider();
    }
  }
  return localeProvider;
}

/**
 * Set a custom locale provider
 */
export function setLocaleProvider(provider: LocaleProvider): void {
  localeProvider = provider;
}

/**
 * Get the current locale
 */
export function getCurrentLocale(): Locale {
  const provider = initializeLocaleProvider();
  return provider.getCurrentLocale();
}

/**
 * Set the current locale
 */
export function setCurrentLocale(locale: Locale): void {
  const provider = initializeLocaleProvider();
  if (provider.setCurrentLocale) {
    provider.setCurrentLocale(locale);
  }
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return ['en', 'ja'];
}

/**
 * Check if a locale is supported
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return locale === 'en' || locale === 'ja';
}

/**
 * Template context for message formatting
 */
export interface MessageContext {
  [key: string]: string | number | string[] | undefined;
}

/**
 * Format a message template with context values
 */
export function formatTemplate(template: string, context: MessageContext = {}): string {
  let result = template;

  // Replace all placeholders with context values
  Object.keys(context).forEach((key) => {
    const value = context[key];
    if (value !== undefined) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      if (Array.isArray(value)) {
        result = result.replace(placeholder, value.join(', '));
      } else {
        result = result.replace(placeholder, String(value));
      }
    }
  });

  return result;
}

/**
 * Message bundle interface
 */
export interface MessageBundle {
  [locale: string]: {
    [key: string]: string;
  };
}

/**
 * Get a message from a bundle
 */
export function getMessage(
  bundle: MessageBundle,
  key: string,
  context: MessageContext = {},
  locale?: Locale,
): string {
  const currentLocale = locale || getCurrentLocale();
  const messages = bundle[currentLocale] || bundle['en'];

  if (!messages) {
    return key;
  }

  const template = messages[key];
  if (!template) {
    // Fall back to English if key not found in current locale
    const enMessages = bundle['en'];
    if (enMessages && enMessages[key]) {
      return formatTemplate(enMessages[key], context);
    }
    return key;
  }

  return formatTemplate(template, context);
}
