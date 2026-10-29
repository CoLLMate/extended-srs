// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as YAML from 'yaml';

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const lineCounters = new WeakMap<YAML.Document.Parsed, YAML.LineCounter>();

function exceedsMetadataLimit(source: string): boolean {
  if (source.length > MAX_METADATA_BYTES) {
    return true;
  }
  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code < 0x80) {
      bytes++;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      source.charCodeAt(i + 1) >= 0xdc00 &&
      source.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else {
      // Unpaired surrogates encode as the three-byte replacement character.
      bytes += 3;
    }
    if (bytes > MAX_METADATA_BYTES) {
      return true;
    }
  }
  return false;
}

/** Parse once, retaining the AST for diagnostics and edits. Duplicate checks are linear. */
export function parseYamlDocument(source: string): YAML.Document.Parsed {
  if (exceedsMetadataLimit(source)) {
    throw new Error('YAML metadata block exceeds the supported limit of 4 MiB (UTF-8)');
  }
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(source, {
    keepSourceTokens: true,
    strict: false,
    uniqueKeys: false,
    lineCounter,
  });
  lineCounters.set(doc, lineCounter);
  YAML.visit(doc, {
    Map(_key, map) {
      const seen = new Set<unknown>();
      for (const pair of map.items) {
        const key = pair.key;
        const value = YAML.isScalar(key) ? key.value : key;
        // yaml's default comparison uses ===, not SameValueZero: NaN is not equal to itself.
        if (typeof value === 'number' && Number.isNaN(value)) {
          continue;
        }
        if (seen.has(value)) {
          const start = YAML.isNode(key) ? (key.range?.[0] ?? 0) : 0;
          const end = YAML.isNode(key) ? (key.range?.[1] ?? start) : start;
          const position = lineCounter.linePos(start);
          const error = new YAML.YAMLParseError(
            [start, end],
            'DUPLICATE_KEY',
            `Map keys must be unique at line ${position.line}, column ${position.col}`,
          );
          error.linePos = [position, lineCounter.linePos(end)];
          doc.errors.push(error);
        } else {
          seen.add(value);
        }
      }
    },
  });
  return doc;
}

/** Index source positions once; many diagnostics must not repeatedly scan a wide map. */
export function createYamlLineLookup(doc: YAML.Document.Parsed): (path: string[]) => number {
  let positions: Map<string, number> | undefined;
  const counter = lineCounters.get(doc)!;
  function index(node: unknown, path: string[], key: unknown = node): void {
    if (YAML.isNode(key) && key.range) {
      positions!.set(JSON.stringify(path), key.range[0]);
    }
    if (YAML.isMap(node)) {
      for (const pair of node.items) {
        if (YAML.isScalar(pair.key)) {
          index(pair.value, [...path, String(pair.key.value)], pair.key);
        }
      }
    } else if (YAML.isSeq(node)) {
      node.items.forEach((item, i) => index(item, [...path, String(i)]));
    }
  }
  return (path) => {
    if (!positions) {
      positions = new Map();
      index(doc.contents, []);
    }
    return counter.linePos(positions.get(JSON.stringify(path)) ?? 0).line - 1;
  };
}
