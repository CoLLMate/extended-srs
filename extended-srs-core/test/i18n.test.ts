// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Extended SRS i18n Module
 * Covers: core.ts (locale, formatTemplate, getMessage),
 *         adapter.ts (getErrorMessage, formatErrorFromData, getUIMessage),
 *         errorCodes.ts (ErrorCode, getErrorCode)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  // core
  setLocaleProvider,
  getCurrentLocale,
  setCurrentLocale,
  getAvailableLocales,
  isLocaleSupported,
  formatTemplate,
  getMessage,
  type Locale,
  type LocaleProvider,
  type MessageBundle,

  // adapter
  getErrorMessage,
  formatErrorFromData,
  getUIMessage,

  // errorCodes
  ErrorCode,
  getErrorCode,
} from '../src/i18n';

// Custom locale provider for testing
class TestLocaleProvider implements LocaleProvider {
  private locale: Locale = 'en';

  getCurrentLocale(): Locale {
    return this.locale;
  }

  setCurrentLocale(locale: Locale): void {
    this.locale = locale;
  }
}

describe('i18n', () => {
  let testProvider: TestLocaleProvider;

  beforeEach(() => {
    testProvider = new TestLocaleProvider();
    setLocaleProvider(testProvider);
  });

  describe('built-in locale providers', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubGlobal('window', undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it.each([
      { srs: 'ja', lang: 'en_US.UTF-8', expected: 'ja' },
      { srs: undefined, lang: 'ja_JP.UTF-8', expected: 'ja' },
      { srs: 'en', lang: 'ja_JP.UTF-8', expected: 'en' },
    ])('uses SRS_LOCALE=$srs before LANG=$lang', async ({ srs, lang, expected }) => {
      vi.stubEnv('SRS_LOCALE', srs);
      vi.stubEnv('LANG', lang);
      const core = await import('../src/i18n/core');
      expect(core.getCurrentLocale()).toBe(expected);
    });

    it('remembers an explicit locale when no environment override is set', async () => {
      vi.stubEnv('SRS_LOCALE', undefined);
      vi.stubEnv('LANG', undefined);
      const core = await import('../src/i18n/core');
      expect(core.getCurrentLocale()).toBe('en');
      core.setCurrentLocale('ja');
      expect(core.getCurrentLocale()).toBe('ja');
      core.setCurrentLocale('en');
      expect(core.getCurrentLocale()).toBe('en');
    });

    it.each([
      { stored: 'ja', language: 'en-US', expected: 'ja' },
      { stored: 'en', language: 'ja-JP', expected: 'en' },
      { stored: 'fr', language: 'JA-JP', expected: 'ja' },
      { stored: undefined, language: 'fr-FR', expected: 'en' },
    ])(
      'uses browser preference $stored with language $language',
      async ({ stored, language, expected }) => {
        const storage = new Map<string, string>();
        if (stored) {
          storage.set('app-locale', stored);
        }
        vi.stubGlobal('window', { navigator: { language } });
        vi.stubGlobal('localStorage', {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        });
        const core = await import('../src/i18n/core');
        expect(core.getCurrentLocale()).toBe(expected);
        core.setCurrentLocale('ja');
        expect(storage.get('app-locale')).toBe('ja');
        expect(core.getCurrentLocale()).toBe('ja');
      },
    );
  });

  describe('core - locale management', () => {
    it('should get current locale', () => {
      expect(getCurrentLocale()).toBe('en');
    });

    it('should set current locale', () => {
      setCurrentLocale('ja');
      expect(getCurrentLocale()).toBe('ja');
    });

    it('should return available locales', () => {
      const locales = getAvailableLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('ja');
    });

    it('should check if locale is supported', () => {
      expect(isLocaleSupported('en')).toBe(true);
      expect(isLocaleSupported('ja')).toBe(true);
      expect(isLocaleSupported('fr')).toBe(false);
      expect(isLocaleSupported('')).toBe(false);
    });

    it('should accept custom locale provider', () => {
      const custom: LocaleProvider = {
        getCurrentLocale: () => 'ja',
      };
      setLocaleProvider(custom);
      expect(getCurrentLocale()).toBe('ja');
    });

    it('should handle provider without setCurrentLocale', () => {
      const readonlyProvider: LocaleProvider = {
        getCurrentLocale: () => 'en',
        // No setCurrentLocale
      };
      setLocaleProvider(readonlyProvider);
      // Should not throw
      setCurrentLocale('ja');
      // Still returns 'en' because provider doesn't support setting
      expect(getCurrentLocale()).toBe('en');
    });
  });

  describe('core - formatTemplate', () => {
    it('should replace single placeholder', () => {
      expect(formatTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
    });

    it('should replace multiple placeholders', () => {
      const result = formatTemplate('{{field}} must be {{type}}', {
        field: 'name',
        type: 'string',
      });
      expect(result).toBe('name must be string');
    });

    it('should replace same placeholder multiple times', () => {
      const result = formatTemplate('{{x}} + {{x}} = 2*{{x}}', { x: '5' });
      expect(result).toBe('5 + 5 = 2*5');
    });

    it('should handle number values', () => {
      expect(formatTemplate('Min length: {{limit}}', { limit: 3 })).toBe('Min length: 3');
    });

    it('should handle array values (joined with comma)', () => {
      expect(formatTemplate('Allowed: {{values}}', { values: ['a', 'b', 'c'] })).toBe(
        'Allowed: a, b, c',
      );
    });

    it('should leave placeholder when value is undefined', () => {
      expect(formatTemplate('Hello {{name}}', {})).toBe('Hello {{name}}');
    });

    it('should handle empty context', () => {
      expect(formatTemplate('No placeholders')).toBe('No placeholders');
    });

    it('should handle template with no placeholders', () => {
      expect(formatTemplate('Plain text', { key: 'value' })).toBe('Plain text');
    });
  });

  describe('core - getMessage', () => {
    const testBundle: MessageBundle = {
      en: {
        greeting: 'Hello {{name}}',
        simple: 'Simple message',
        onlyEn: 'English only',
      },
      ja: {
        greeting: 'こんにちは {{name}}',
        simple: 'シンプルメッセージ',
      },
    };

    it('should get message for current locale (en)', () => {
      expect(getMessage(testBundle, 'simple')).toBe('Simple message');
    });

    it('should get message for Japanese locale', () => {
      setCurrentLocale('ja');
      expect(getMessage(testBundle, 'simple')).toBe('シンプルメッセージ');
    });

    it('should apply template context', () => {
      expect(getMessage(testBundle, 'greeting', { name: 'World' })).toBe('Hello World');
    });

    it('should apply template context in Japanese', () => {
      setCurrentLocale('ja');
      expect(getMessage(testBundle, 'greeting', { name: 'テスト' })).toBe('こんにちは テスト');
    });

    it('should fall back to English when key not found in current locale', () => {
      setCurrentLocale('ja');
      expect(getMessage(testBundle, 'onlyEn')).toBe('English only');
    });

    it('should return key when not found in any locale', () => {
      expect(getMessage(testBundle, 'nonexistent')).toBe('nonexistent');
    });

    it('should override locale with explicit parameter', () => {
      // Current is 'en', but specify 'ja'
      expect(getMessage(testBundle, 'simple', {}, 'ja')).toBe('シンプルメッセージ');
    });

    it('should handle empty bundle', () => {
      const emptyBundle: MessageBundle = {};
      expect(getMessage(emptyBundle, 'key')).toBe('key');
    });

    it('should handle bundle with no English fallback', () => {
      const jaOnlyBundle: MessageBundle = {
        ja: { key: '日本語のみ' },
      };
      setCurrentLocale('ja');
      expect(getMessage(jaOnlyBundle, 'key')).toBe('日本語のみ');
    });
  });

  describe('errorCodes - getErrorCode', () => {
    describe('required keyword', () => {
      it('should return REQUIRED_MANIFEST for missing manifest', () => {
        expect(getErrorCode({ keyword: 'required', params: { missingProperty: 'manifest' } })).toBe(
          ErrorCode.REQUIRED_MANIFEST,
        );
      });

      it('should return REQUIRED_FORMAT for missing format', () => {
        expect(getErrorCode({ keyword: 'required', params: { missingProperty: 'format' } })).toBe(
          ErrorCode.REQUIRED_FORMAT,
        );
      });

      it('should return REQUIRED_VERSION for missing version', () => {
        expect(getErrorCode({ keyword: 'required', params: { missingProperty: 'version' } })).toBe(
          ErrorCode.REQUIRED_VERSION,
        );
      });

      it('should return REQUIRED_FIELD for other required fields', () => {
        expect(
          getErrorCode({ keyword: 'required', params: { missingProperty: 'project_name' } }),
        ).toBe(ErrorCode.REQUIRED_FIELD);
      });
    });

    describe('type keyword', () => {
      it('should return TYPE_STRING_EXPECTED for string', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'string' } })).toBe(
          ErrorCode.TYPE_STRING_EXPECTED,
        );
      });

      it('should return TYPE_NUMBER_EXPECTED for number', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'number' } })).toBe(
          ErrorCode.TYPE_NUMBER_EXPECTED,
        );
      });

      it('should return TYPE_NUMBER_EXPECTED for integer', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'integer' } })).toBe(
          ErrorCode.TYPE_NUMBER_EXPECTED,
        );
      });

      it('should return TYPE_BOOLEAN_EXPECTED for boolean', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'boolean' } })).toBe(
          ErrorCode.TYPE_BOOLEAN_EXPECTED,
        );
      });

      it('should return TYPE_OBJECT_EXPECTED for object', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'object' } })).toBe(
          ErrorCode.TYPE_OBJECT_EXPECTED,
        );
      });

      it('should return TYPE_ARRAY_EXPECTED for array', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'array' } })).toBe(
          ErrorCode.TYPE_ARRAY_EXPECTED,
        );
      });

      it('should return TYPE_MISMATCH for unknown type', () => {
        expect(getErrorCode({ keyword: 'type', params: { type: 'custom' } })).toBe(
          ErrorCode.TYPE_MISMATCH,
        );
      });
    });

    describe('format keyword', () => {
      it('should return FORMAT_DATE_INVALID for date', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'date' } })).toBe(
          ErrorCode.FORMAT_DATE_INVALID,
        );
      });

      it('should return FORMAT_DATE_INVALID for date-time', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'date-time' } })).toBe(
          ErrorCode.FORMAT_DATE_INVALID,
        );
      });

      it('should return FORMAT_EMAIL_INVALID for email', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'email' } })).toBe(
          ErrorCode.FORMAT_EMAIL_INVALID,
        );
      });

      it('should return FORMAT_URL_INVALID for uri', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'uri' } })).toBe(
          ErrorCode.FORMAT_URL_INVALID,
        );
      });

      it('should return FORMAT_URL_INVALID for url', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'url' } })).toBe(
          ErrorCode.FORMAT_URL_INVALID,
        );
      });

      it('should return FORMAT_UUID_INVALID for uuid', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'uuid' } })).toBe(
          ErrorCode.FORMAT_UUID_INVALID,
        );
      });

      it('should return FORMAT_INVALID for unknown format', () => {
        expect(getErrorCode({ keyword: 'format', params: { format: 'custom' } })).toBe(
          ErrorCode.FORMAT_INVALID,
        );
      });
    });

    describe('const keyword', () => {
      it('should return MANIFEST_FORMAT_INVALID for manifest format', () => {
        expect(
          getErrorCode({
            keyword: 'const',
            instancePath: '/manifest/format',
            params: {},
          }),
        ).toBe(ErrorCode.MANIFEST_FORMAT_INVALID);
      });

      it('should return VALIDATION_ERROR for other const errors', () => {
        expect(getErrorCode({ keyword: 'const', instancePath: '/other/path', params: {} })).toBe(
          ErrorCode.VALIDATION_ERROR,
        );
      });
    });

    describe('other keywords', () => {
      it('should map enum to ENUM_INVALID', () => {
        expect(getErrorCode({ keyword: 'enum' })).toBe(ErrorCode.ENUM_INVALID);
      });

      it('should map pattern to PATTERN_INVALID', () => {
        expect(getErrorCode({ keyword: 'pattern' })).toBe(ErrorCode.PATTERN_INVALID);
      });

      it('should map minLength to MIN_LENGTH', () => {
        expect(getErrorCode({ keyword: 'minLength' })).toBe(ErrorCode.MIN_LENGTH);
      });

      it('should map maxLength to MAX_LENGTH', () => {
        expect(getErrorCode({ keyword: 'maxLength' })).toBe(ErrorCode.MAX_LENGTH);
      });

      it('should map minimum to MINIMUM_VALUE', () => {
        expect(getErrorCode({ keyword: 'minimum' })).toBe(ErrorCode.MINIMUM_VALUE);
      });

      it('should map maximum to MAXIMUM_VALUE', () => {
        expect(getErrorCode({ keyword: 'maximum' })).toBe(ErrorCode.MAXIMUM_VALUE);
      });

      it('should map additionalProperties to ADDITIONAL_PROPERTY', () => {
        expect(getErrorCode({ keyword: 'additionalProperties' })).toBe(
          ErrorCode.ADDITIONAL_PROPERTY,
        );
      });

      it('should return VALIDATION_ERROR for unknown keywords', () => {
        expect(getErrorCode({ keyword: 'unknownKeyword' })).toBe(ErrorCode.VALIDATION_ERROR);
      });
    });
  });

  describe('adapter - getErrorMessage', () => {
    it('should return English error message for REQUIRED_FIELD', () => {
      const msg = getErrorMessage(ErrorCode.REQUIRED_FIELD, { field: 'name' });
      expect(msg).toContain('name');
      expect(msg).toContain('Missing required');
    });

    it('should return Japanese error message when locale is ja', () => {
      setCurrentLocale('ja');
      const msg = getErrorMessage(ErrorCode.REQUIRED_FIELD, { field: 'name' });
      expect(msg).toContain('name');
      expect(msg).toContain('ありません');
    });

    it('should return message for REQUIRED_MANIFEST', () => {
      const msg = getErrorMessage(ErrorCode.REQUIRED_MANIFEST);
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should return message for TYPE_STRING_EXPECTED', () => {
      const msg = getErrorMessage(ErrorCode.TYPE_STRING_EXPECTED, { field: 'project_name' });
      expect(msg).toContain('project_name');
    });

    it('should return message for ENUM_INVALID with allowedValues', () => {
      const msg = getErrorMessage(ErrorCode.ENUM_INVALID, {
        field: 'status',
        allowedValues: ['draft', 'active', 'closed'],
      });
      expect(msg).toContain('status');
      expect(msg).toContain('draft');
    });

    it('should return message for MIN_LENGTH with limit', () => {
      const msg = getErrorMessage(ErrorCode.MIN_LENGTH, { field: 'name', limit: 3 });
      expect(msg).toContain('name');
      expect(msg).toContain('3');
    });

    it('should return message for MAX_LENGTH with limit', () => {
      const msg = getErrorMessage(ErrorCode.MAX_LENGTH, { field: 'name', limit: 100 });
      expect(msg).toContain('name');
      expect(msg).toContain('100');
    });

    it('should return message for PATTERN_INVALID', () => {
      const msg = getErrorMessage(ErrorCode.PATTERN_INVALID, { field: 'version' });
      expect(msg).toContain('version');
    });

    it('should return generic message for VALIDATION_ERROR', () => {
      const msg = getErrorMessage(ErrorCode.VALIDATION_ERROR);
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should handle missing context gracefully', () => {
      const msg = getErrorMessage(ErrorCode.REQUIRED_FIELD);
      expect(msg).toContain('{{field}}'); // Unreplaced placeholder
    });
  });

  describe('adapter - formatErrorFromData', () => {
    it('should format required error', () => {
      const msg = formatErrorFromData({
        keyword: 'required',
        instancePath: '/manifest',
        params: { missingProperty: 'format' },
      });
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should format type error', () => {
      const msg = formatErrorFromData({
        keyword: 'type',
        instancePath: '/manifest/project_name',
        params: { type: 'string' },
      });
      expect(msg).toContain('project_name');
    });

    it('should format additionalProperties error', () => {
      const msg = formatErrorFromData({
        keyword: 'additionalProperties',
        instancePath: '/manifest',
        params: { additionalProperty: 'unknownProp' },
      });
      expect(msg).toContain('unknownProp');
    });

    it('should format const error', () => {
      const msg = formatErrorFromData({
        keyword: 'const',
        instancePath: '/manifest/format',
        params: { allowedValue: 'extended-srs/v1' },
      });
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should format enum error', () => {
      const msg = formatErrorFromData({
        keyword: 'enum',
        instancePath: '/status',
        params: { allowedValues: ['draft', 'active'] },
      });
      expect(msg).toContain('draft');
    });

    it('should format pattern error', () => {
      const msg = formatErrorFromData({
        keyword: 'pattern',
        instancePath: '/manifest/version',
        params: { pattern: '^\\d+\\.\\d+\\.\\d+$' },
      });
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should format minLength error', () => {
      const msg = formatErrorFromData({
        keyword: 'minLength',
        instancePath: '/manifest/project_name',
        params: { limit: 1 },
      });
      expect(msg).toContain('1');
    });

    it('should format maxLength error', () => {
      const msg = formatErrorFromData({
        keyword: 'maxLength',
        instancePath: '/manifest/description',
        params: { limit: 500 },
      });
      expect(msg).toContain('500');
    });

    it('should format minimum error', () => {
      const msg = formatErrorFromData({
        keyword: 'minimum',
        instancePath: '/config/priority',
        params: { limit: 0 },
      });
      expect(msg).toContain('0');
    });

    it('should format maximum error', () => {
      const msg = formatErrorFromData({
        keyword: 'maximum',
        instancePath: '/config/priority',
        params: { limit: 100 },
      });
      expect(msg).toContain('100');
    });

    it('should handle null input', () => {
      const msg = formatErrorFromData(null);
      expect(msg.length).toBeGreaterThan(0); // Returns generic validation error
    });

    it('should handle non-object input', () => {
      const msg = formatErrorFromData('string');
      expect(msg.length).toBeGreaterThan(0);
    });

    it('should extract field from instancePath', () => {
      const msg = formatErrorFromData({
        keyword: 'type',
        instancePath: '/manifest/metadata/author',
        params: { type: 'string' },
      });
      expect(msg).toContain('author');
    });

    it('should handle empty instancePath', () => {
      const msg = formatErrorFromData({
        keyword: 'required',
        instancePath: '',
        params: { missingProperty: 'manifest' },
      });
      expect(msg.length).toBeGreaterThan(0);
    });
  });

  describe('adapter - getUIMessage', () => {
    it('should get quickFixAvailable message', () => {
      const msg = getUIMessage('quickFixAvailable');
      expect(msg).toContain('Quick fix');
    });

    it('should get addMissingProperty message with context', () => {
      const msg = getUIMessage('addMissingProperty', { property: 'format' });
      expect(msg).toContain('format');
    });

    it('should get fixTypeError message with context', () => {
      const msg = getUIMessage('fixTypeError', { property: 'name', type: 'string' });
      expect(msg).toContain('name');
      expect(msg).toContain('string');
    });

    it('should get removeUndefinedProperty message', () => {
      const msg = getUIMessage('removeUndefinedProperty', { property: 'unknownProp' });
      expect(msg).toContain('unknownProp');
    });

    it('should get Japanese UI messages when locale is ja', () => {
      setCurrentLocale('ja');
      const msg = getUIMessage('quickFixAvailable');
      expect(msg).toContain('クイックフィックス');
    });

    it('should return key for unknown UI message', () => {
      const msg = getUIMessage('nonexistentKey');
      expect(msg).toBe('nonexistentKey');
    });
  });

  describe('ErrorCode enum values', () => {
    it('should have expected error code values', () => {
      expect(ErrorCode.REQUIRED_FIELD).toBe('SRS_REQUIRED_FIELD');
      expect(ErrorCode.REQUIRED_MANIFEST).toBe('SRS_REQUIRED_MANIFEST');
      expect(ErrorCode.REQUIRED_FORMAT).toBe('SRS_REQUIRED_FORMAT');
      expect(ErrorCode.REQUIRED_VERSION).toBe('SRS_REQUIRED_VERSION');
      expect(ErrorCode.TYPE_MISMATCH).toBe('SRS_TYPE_MISMATCH');
      expect(ErrorCode.VALIDATION_ERROR).toBe('SRS_VALIDATION_ERROR');
    });
  });
});
