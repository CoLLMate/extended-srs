// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Extended SRS Merge Utilities
 * Covers: deepMerge, mergeArrays, parsePath, getValueAtPath, setValueAtPath, removeValueAtPath, trackSource
 */

import { describe, it, expect } from 'vitest';
import {
  deepMerge,
  mergeArrays,
  parsePath,
  getValueAtPath,
  setValueAtPath,
  removeValueAtPath,
} from '../src/aggregation/mergeUtils';
import type { MergeOptions, MergeContext } from '../src/aggregation/mergeUtils';
import type { MetadataLocation } from '../src/tree/treeTypes';

// Helper to create MetadataLocation
function makeLocation(filepath: string, lineStart = 1, lineEnd = 5): MetadataLocation {
  return { filepath, lineStart, lineEnd, timestamp: Date.now() };
}

describe('mergeUtils', () => {
  describe('deepMerge', () => {
    describe('last-write strategy (default)', () => {
      it('should overwrite primitive values', () => {
        const target = { a: 1, b: 2 };
        deepMerge(target, { a: 10, c: 3 });
        expect(target).toEqual({ a: 10, b: 2, c: 3 });
      });

      it('should replace arrays entirely', () => {
        const target = { items: [1, 2, 3] };
        deepMerge(target, { items: [4, 5] });
        expect(target.items).toEqual([4, 5]);
      });

      it('should deep merge nested objects', () => {
        const target = { config: { level1: { a: 1, b: 2 } } };
        deepMerge(target, { config: { level1: { b: 3, c: 4 } } });
        expect(target.config.level1).toEqual({ a: 1, b: 3, c: 4 });
      });

      it('should create target object when it does not exist', () => {
        const target: any = {};
        deepMerge(target, { nested: { deep: { value: 'hello' } } });
        expect(target.nested.deep.value).toBe('hello');
      });

      it('should replace non-object target with object', () => {
        const target: any = { config: 'string-value' };
        deepMerge(target, { config: { key: 'value' } });
        expect(target.config).toEqual({ key: 'value' });
      });

      it('should replace array target with object', () => {
        const target: any = { config: [1, 2, 3] };
        deepMerge(target, { config: { key: 'value' } });
        expect(target.config).toEqual({ key: 'value' });
      });
    });

    describe('first-write strategy', () => {
      const options: MergeOptions = { overrideStrategy: 'first-write' };

      it('should keep existing primitive values', () => {
        const target = { a: 1 };
        deepMerge(target, { a: 10, b: 2 }, '', options);
        expect(target.a).toBe(1); // first-write keeps original
        expect((target as any).b).toBe(2); // new key is added
      });

      it('should keep existing arrays', () => {
        const target = { items: [1, 2] };
        deepMerge(target, { items: [3, 4] }, '', options);
        expect(target.items).toEqual([1, 2]); // kept original
      });

      it('should add new array when target has none', () => {
        const target: any = {};
        deepMerge(target, { items: [3, 4] }, '', options);
        expect(target.items).toEqual([3, 4]);
      });
    });

    describe('null and undefined handling', () => {
      it.each([null, undefined])('should ignore an empty source (%s)', (source) => {
        const target = { manifest: { project_name: 'Test' } };
        deepMerge(target, source);
        expect(target).toEqual({ manifest: { project_name: 'Test' } });
      });

      it('should skip null source values', () => {
        const target = { a: 1 };
        deepMerge(target, { a: null });
        expect(target.a).toBe(1);
      });

      it('should skip undefined source values', () => {
        const target = { a: 1 };
        deepMerge(target, { a: undefined });
        expect(target.a).toBe(1);
      });
    });

    describe('source tracking', () => {
      it('should track sources when trackSources is enabled with MetadataLocation', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const location = makeLocation('file1.md');
        const options: MergeOptions = { trackSources: true };
        const context: MergeContext = { sources, currentLocation: location };

        deepMerge(target, { name: 'test' }, '', options, context);

        expect(sources.has('name')).toBe(true);
        expect(sources.get('name')![0].filepath).toBe('file1.md');
      });

      it('should track sources with file path style', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const options: MergeOptions = { trackSources: true };
        const context: MergeContext = { sources, currentFilePath: 'file2.md' };

        deepMerge(target, { name: 'test' }, '', options, context);

        expect(sources.has('name')).toBe(true);
        expect(sources.get('name')![0].filepath).toBe('file2.md');
      });

      it('should accumulate multiple sources for same path', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const options: MergeOptions = { trackSources: true };

        deepMerge(target, { name: 'first' }, '', options, {
          sources,
          currentLocation: makeLocation('file1.md'),
        });
        deepMerge(target, { name: 'second' }, '', options, {
          sources,
          currentLocation: makeLocation('file2.md'),
        });

        expect(sources.get('name')!).toHaveLength(2);
      });

      it('should not track sources when trackSources is false', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const context: MergeContext = { sources, currentLocation: makeLocation('file1.md') };

        deepMerge(target, { name: 'test' }, '', {}, context);

        expect(sources.size).toBe(0);
      });

      it('should not track when sources map is missing', () => {
        const target: any = {};
        const options: MergeOptions = { trackSources: true };
        // No sources map in context
        expect(() => {
          deepMerge(target, { name: 'test' }, '', options, {});
        }).not.toThrow();
      });
    });

    describe('override tracking', () => {
      it('should track overridden fields', () => {
        const target = { name: 'original' };
        const overrides = new Set<string>();
        const options: MergeOptions = { trackOverrides: true };
        const context: MergeContext = { overrides };

        deepMerge(target, { name: 'updated' }, '', options, context);

        expect(overrides.has('name')).toBe(true);
      });

      it('should not track new fields as overrides', () => {
        const target: any = {};
        const overrides = new Set<string>();
        const options: MergeOptions = { trackOverrides: true };
        const context: MergeContext = { overrides };

        deepMerge(target, { name: 'new' }, '', options, context);

        expect(overrides.has('name')).toBe(false);
      });
    });

    describe('path building', () => {
      it('should build correct dot-delimited paths', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const options: MergeOptions = { trackSources: true };
        const context: MergeContext = { sources, currentLocation: makeLocation('f.md') };

        deepMerge(target, { a: { b: { c: 'value' } } }, '', options, context);

        expect(sources.has('a.b.c')).toBe(true);
      });

      it('should handle custom base path', () => {
        const target: any = {};
        const sources = new Map<string, any[]>();
        const options: MergeOptions = { trackSources: true };
        const context: MergeContext = { sources, currentLocation: makeLocation('f.md') };

        deepMerge(target, { key: 'val' }, 'prefix', options, context);

        expect(sources.has('prefix.key')).toBe(true);
      });
    });
  });

  describe('mergeArrays', () => {
    it('should replace array with last-write strategy', () => {
      const result = mergeArrays([1, 2], [3, 4], 'path');
      expect(result).toEqual([3, 4]);
    });

    it('should keep original with first-write strategy when target exists', () => {
      const result = mergeArrays([1, 2], [3, 4], 'path', {
        overrideStrategy: 'first-write',
      });
      expect(result).toEqual([1, 2]);
    });

    it('should use source when target is falsy with first-write strategy', () => {
      const result = mergeArrays(undefined as any, [3, 4], 'path', {
        overrideStrategy: 'first-write',
      });
      expect(result).toEqual([3, 4]);
    });

    it('should return copy of source, not reference', () => {
      const source = [1, 2, 3];
      const result = mergeArrays([], source, 'path');
      source.push(4);
      expect(result).toEqual([1, 2, 3]); // Not affected by mutation
    });

    it('should handle empty arrays', () => {
      expect(mergeArrays([], [], 'path')).toEqual([]);
      expect(mergeArrays([1], [], 'path')).toEqual([]);
      expect(mergeArrays([], [1], 'path')).toEqual([1]);
    });
  });

  describe('parsePath', () => {
    it('should parse simple colon-separated path', () => {
      expect(parsePath('manifest')).toEqual([{ key: 'manifest' }]);
    });

    it('should parse multi-segment colon-separated path', () => {
      expect(parsePath('use-cases: actors')).toEqual([{ key: 'use-cases' }, { key: 'actors' }]);
    });

    it('should parse path with array notation', () => {
      expect(parsePath('use-cases: list[0]')).toEqual([
        { key: 'use-cases' },
        { key: 'list', index: 0 },
      ]);
    });

    it('should parse multiple array indices', () => {
      expect(parsePath('a: b[1]: c[2]')).toEqual([
        { key: 'a' },
        { key: 'b', index: 1 },
        { key: 'c', index: 2 },
      ]);
    });

    it('should handle paths without spaces around colons', () => {
      expect(parsePath('a:b:c')).toEqual([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    });

    it('should trim whitespace from path parts', () => {
      expect(parsePath('  a  :  b  ')).toEqual([{ key: 'a' }, { key: 'b' }]);
    });

    it('should handle single array-notation path', () => {
      expect(parsePath('items[5]')).toEqual([{ key: 'items', index: 5 }]);
    });

    it('should parse deeply nested path', () => {
      expect(parsePath('a: b: c: d: e')).toHaveLength(5);
    });
  });

  describe('getValueAtPath', () => {
    const obj = {
      manifest: {
        project_name: 'Test',
        format: 'extended-srs/v1',
      },
      items: [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
      ],
      nested: {
        deep: {
          value: 42,
        },
      },
    };

    it('should get top-level value', () => {
      const path = parsePath('manifest');
      expect(getValueAtPath(obj, path)).toEqual(obj.manifest);
    });

    it('should get nested object value', () => {
      const path = parsePath('manifest: project_name');
      expect(getValueAtPath(obj, path)).toBe('Test');
    });

    it('should get array item by index', () => {
      const path = parsePath('items[0]');
      expect(getValueAtPath(obj, path)).toEqual({ id: 1, name: 'first' });
    });

    it('should get nested value within array item', () => {
      const path = parsePath('items[1]: name');
      expect(getValueAtPath(obj, path)).toBe('second');
    });

    it('should get deeply nested value', () => {
      const path = parsePath('nested: deep: value');
      expect(getValueAtPath(obj, path)).toBe(42);
    });

    it('should return undefined for non-existent key', () => {
      const path = parsePath('nonexistent');
      expect(getValueAtPath(obj, path)).toBeUndefined();
    });

    it('should return undefined for non-existent nested key', () => {
      const path = parsePath('manifest: nonexistent');
      expect(getValueAtPath(obj, path)).toBeUndefined();
    });

    it('should return undefined for out-of-bounds array index', () => {
      const path = parsePath('items[99]');
      expect(getValueAtPath(obj, path)).toBeUndefined();
    });

    it('should return undefined when accessing array on non-array', () => {
      const path = parsePath('manifest[0]');
      expect(getValueAtPath(obj, path)).toBeUndefined();
    });

    it('should return undefined when traversing through primitive', () => {
      const path = parsePath('manifest: project_name: sub');
      expect(getValueAtPath(obj, path)).toBeUndefined();
    });

    it('should handle empty path parts array', () => {
      expect(getValueAtPath(obj, [])).toBe(obj);
    });
  });

  describe('setValueAtPath', () => {
    it('should set top-level value', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('name'), 'test');
      expect(obj.name).toBe('test');
    });

    it('should set nested value, creating intermediates', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('a: b: c'), 'deep');
      expect(obj.a.b.c).toBe('deep');
    });

    it('should set array item', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('items[0]'), { id: 1 });
      expect(obj.items[0]).toEqual({ id: 1 });
    });

    it('should set nested value within array item', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('items[0]: name'), 'first');
      expect(obj.items[0].name).toBe('first');
    });

    it('should create array when it does not exist', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('list[2]'), 'value');
      expect(Array.isArray(obj.list)).toBe(true);
      expect(obj.list[2]).toBe('value');
    });

    it('should overwrite existing value', () => {
      const obj: any = { name: 'old' };
      setValueAtPath(obj, parsePath('name'), 'new');
      expect(obj.name).toBe('new');
    });

    it('should handle complex path with mixed arrays and objects', () => {
      const obj: any = {};
      setValueAtPath(obj, parsePath('data: items[0]: sub: values[1]'), 'target');
      expect(obj.data.items[0].sub.values[1]).toBe('target');
    });
  });

  describe('removeValueAtPath', () => {
    it('should remove top-level key', () => {
      const obj: any = { a: 1, b: 2 };
      removeValueAtPath(obj, parsePath('a'));
      expect(obj).toEqual({ b: 2 });
    });

    it('should remove nested key', () => {
      const obj: any = { config: { a: 1, b: 2 } };
      removeValueAtPath(obj, parsePath('config: a'));
      expect(obj.config).toEqual({ b: 2 });
    });

    it('should remove array item by index (splice)', () => {
      const obj: any = { items: ['a', 'b', 'c'] };
      removeValueAtPath(obj, parsePath('items[1]'));
      expect(obj.items).toEqual(['a', 'c']);
    });

    it('should handle removal from non-existent parent gracefully', () => {
      const obj: any = {};
      expect(() => removeValueAtPath(obj, parsePath('nonexistent: key'))).not.toThrow();
    });

    it('should handle removal of array item from non-array gracefully', () => {
      const obj: any = { items: 'not-an-array' };
      expect(() => removeValueAtPath(obj, parsePath('items[0]'))).not.toThrow();
    });

    it('should handle intermediate array access with non-existent array', () => {
      const obj: any = {};
      expect(() => removeValueAtPath(obj, parsePath('arr[0]: key'))).not.toThrow();
    });

    it('should handle intermediate non-object gracefully', () => {
      const obj: any = { a: 'string' };
      expect(() => removeValueAtPath(obj, parsePath('a: b'))).not.toThrow();
    });
  });
});
