// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { stringify } from 'yaml';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getSchemaNodeForPath,
  initializeExtendedSRSSchemas,
  loadExtendedSRSSchema,
  schemaMap,
  transformSchemaToTree,
  validateExtendedSRS,
  validateYAML,
} from '../src';
import { createCoreApi } from '../src/api';

const architectureId = schemaMap['system-architecture-schema.json'].$id;
const contractPath = [
  'system-architecture',
  'architecture',
  'key_components',
  'components',
  '0',
  'modules',
  '0',
  'provided_interfaces',
  '0',
];
const protocols: Record<string, Record<string, unknown>> = {
  'http-api': { type: 'http-api', path: '/items', method: 'POST' },
  grpc: { type: 'grpc', service: 'Items', method: 'Create' },
  graphql: { type: 'graphql', operation_type: 'query', operation_name: 'items' },
  event: { type: 'event', event_name: 'ItemCreated', payload_schema: {} },
  'message-queue': { type: 'message-queue', queue_name: 'items', message_type: 'publish' },
  'database-access': { type: 'database-access', operation: 'query', entity_ref: 'Item' },
  'file-io': { type: 'file-io', operation: 'import', file_format: 'JSON' },
  'library-api': { type: 'library-api', api_type: 'function', exports: [] },
};
const fields = [
  { definition: 'httpApiInterface', field: 'request_schema', protocol: 'http-api' },
  { definition: 'httpApiInterface', field: 'response_schema', protocol: 'http-api' },
  { definition: 'eventInterface', field: 'payload_schema', protocol: 'event' },
  { definition: 'messageQueueInterface', field: 'message_schema', protocol: 'message-queue' },
  { definition: 'fileIoInterface', field: 'schema', protocol: 'file-io' },
  { definition: 'errorHandlingPolicies', field: 'error_response_format', protocol: null },
];

function documentWithContract(protocol = 'http-api', definition = protocols[protocol]): any {
  return {
    manifest: { format: 'extended-srs/v1', project_name: 'Schema contracts' },
    'system-architecture': {
      architecture: {
        design_principles: ['Explicit contracts'],
        key_components: {
          architecture_graph: 'graph TD; API',
          components: [
            {
              component_id: 'API',
              name: 'API',
              type: 'backend',
              tech_stack: {},
              modules: [
                {
                  module_id: 'items',
                  name: 'Items',
                  layer: 'application',
                  module_relative_path: 'src/items',
                  provided_interfaces: [
                    {
                      interface_id: 'create',
                      version: '1.0.0',
                      interface_type: protocol,
                      definition: structuredClone(definition),
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  };
}

function documentWithSchema(field: (typeof fields)[number], value: unknown) {
  const data = documentWithContract(field.protocol ?? 'http-api');
  const path = field.protocol
    ? [...contractPath, 'definition', field.field]
    : ['system-architecture', 'common_technical_policies', 'error_handling', field.field];
  let parent = data;
  for (const part of path.slice(0, -1)) {
    parent = parent[part] ??= {};
  }
  parent[path.at(-1)!] = value;
  return { data, path };
}

const standalone = new Ajv({ allErrors: true, strict: false });
addFormats(standalone);
for (const [name, schema] of Object.entries(schemaMap)) {
  standalone.addSchema(schema, `https://exsrs.org/extended-srs/v1/schemas/${name}`);
}
const fieldValidator = (definition: string, field: string) =>
  standalone.compile({
    $ref: `${architectureId}#/definitions/${definition}/properties/${field}`,
  });

beforeAll(initializeExtendedSRSSchemas);

it('warns about unknown fields inside the matching oneOf branch without masking contract errors', async () => {
  const data = documentWithContract('http-api', { ...protocols['http-api'], extra: 'keep' });
  const before = structuredClone(data);
  for (const result of [await validateExtendedSRS(data), await validateYAML(stringify(data))]) {
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        type: 'unknown-property',
        message: expect.stringContaining('"extra"'),
      }),
    ]);
  }
  expect(data).toEqual(before);
  const invalid = documentWithContract('http-api', {
    ...protocols['http-api'],
    method: 42,
    extra: 'keep',
  });
  expect((await validateExtendedSRS(invalid)).isValid).toBe(false);
  expect((await validateYAML(stringify(invalid))).isValid).toBe(false);
});

describe('User-defined data schemas', () => {
  it('keeps the schema tree type label a string when the source allows object and boolean schemas', () => {
    const field =
      schemaMap['system-architecture-schema.json'].definitions.httpApiInterface.properties
        .request_schema;
    expect(transformSchemaToTree(field).type).toBe('object | boolean');
    expect(field.type).toEqual(['object', 'boolean']);
  });

  it.each(fields)(
    'validates $definition.$field in standalone, full and partial validation',
    async (field) => {
      const value = {
        type: 'object',
        properties: { id: { type: 'string' }, count: { type: 'integer', minimum: 1 } },
        required: ['id'],
        additionalProperties: false,
      };
      const validate = fieldValidator(field.definition, field.field);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      const { data, path } = documentWithSchema(field, value);
      expect(await validateExtendedSRS(data)).toMatchObject({
        isValid: true,
        errors: [],
        warnings: [],
      });
      expect(await validateYAML(JSON.stringify(value), 0, path, true)).toMatchObject({
        isValid: true,
        errors: [],
        warnings: [],
      });

      const invalid = { properties: { id: { type: 123 } } };
      expect(validate(invalid)).toBe(false);
      expect((await validateExtendedSRS(documentWithSchema(field, invalid).data)).isValid).toBe(
        false,
      );
      const partial = await validateYAML(JSON.stringify(invalid), 0, path, true);
      expect(partial.isValid).toBe(false);
      expect(partial.errors.some((error) => error.path.includes('id/type'))).toBe(true);
    },
  );

  it.each(
    [
      {},
      true,
      false,
      { type: 'string' },
      { type: 'null' },
      { type: ['string', 'null'] },
      { type: 'array', items: { type: 'integer' } },
      { items: [{ type: 'string' }, false], additionalItems: false },
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
      { if: { properties: { kind: { const: 'a' } } }, then: { required: ['value'] } },
    ].map((value) => ({ value })),
  )('accepts Draft 7 schema $value', async ({ value }) => {
    expect(fieldValidator('httpApiInterface', 'request_schema')(value)).toBe(true);
    expect((await validateExtendedSRS(documentWithSchema(fields[0], value).data)).isValid).toBe(
      true,
    );
  });

  it.each(
    [
      null,
      'string',
      [],
      { type: 'UserDefinedType' },
      { required: 'id' },
      { properties: { id: 123 } },
      { items: 123 },
      { minimum: 'zero' },
      { required: ['id', 'id'] },
      { allOf: [] },
      { pattern: 123 },
      { $schema: 'https://json-schema.org/draft/2020-12/schema' },
    ].map((value) => ({ value })),
  )('rejects invalid definition $value', async ({ value }) => {
    expect(fieldValidator('httpApiInterface', 'request_schema')(value)).toBe(false);
    expect((await validateExtendedSRS(documentWithSchema(fields[0], value).data)).isValid).toBe(
      false,
    );
  });

  it('keeps unknown keywords and reports their exact locations without treating property names or examples as keywords', async () => {
    const value = {
      type: 'object',
      typo: true,
      properties: { arbitrary_name: { type: 'string', minLenght: 1 } },
      'x-editor': { untouched: true },
      default: { typo: true, $ref: 'not-a-reference' },
      examples: [{ typo: true }],
      const: { typo: true },
      enum: [{ typo: true }],
    };
    const { data, path } = documentWithSchema(fields[0], value);
    const original = JSON.stringify(data);
    const location = [...path, 'properties', 'arbitrary_name', 'minLenght'].join('.');
    const result = await validateExtendedSRS(
      data,
      { [location]: ['api.md'] },
      {
        [location]: [{ filepath: 'api.md', lineStart: 12, lineEnd: 12 }],
      },
    );
    expect(result.isValid).toBe(true);
    expect(result.warnings.map((warning) => warning.path)).toEqual([
      [...path, 'typo'].join('.'),
      location,
    ]);
    expect(result.warnings[1]).toMatchObject({
      type: 'unknown-schema-keyword',
      sourceFile: 'api.md',
      line: 13,
    });
    expect(JSON.stringify(data)).toBe(original);
    const partial = await validateYAML(JSON.stringify(value), 4, path, true);
    expect(partial.warnings).toHaveLength(2);
    expect(partial.warnings[1]).toMatchObject({
      path: '/properties/arbitrary_name/minLenght',
      line: 4,
    });
  });

  it('checks keywords inside every schema-valued keyword, not inside extension data', async () => {
    const nested = { typo: 'preserved' };
    const value = {
      definitions: { A: nested },
      patternProperties: { '^a': nested },
      dependencies: { a: nested, b: ['a'] },
      items: [nested],
      additionalItems: nested,
      additionalProperties: nested,
      contains: nested,
      propertyNames: nested,
      allOf: [nested],
      anyOf: [nested],
      oneOf: [nested],
      not: nested,
      if: nested,
      then: nested,
      else: nested,
      'x-extension': nested,
    };
    const result = await validateExtendedSRS(documentWithSchema(fields[0], value).data);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(15);
    expect(result.warnings.every((warning) => warning.type === 'unknown-schema-keyword')).toBe(
      true,
    );
  });

  it('retains references as data and reports that their targets have not been checked, without fetching them', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      const value = {
        definitions: { Item: { type: 'string' } },
        anyOf: [{ $ref: '#/definitions/Item' }, { $ref: 'https://example.invalid/types.json' }],
      };
      const { data } = documentWithSchema(fields[0], value);
      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(
        result.warnings.every((warning) => warning.type === 'schema-reference-unchecked'),
      ).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('resolves and validates nested schema fields through unions, dictionaries and recursive meta-schema references', async () => {
    const { path } = documentWithSchema(fields[0], {});
    const nestedPath = [...path, 'properties', 'customer', 'properties', 'id', 'type'];
    const node = getSchemaNodeForPath(loadExtendedSRSSchema(), nestedPath);
    expect(node).not.toBeNull();
    expect((await validateYAML('string', 0, nestedPath, true)).isValid).toBe(true);
    expect((await validateYAML('123', 0, nestedPath, true)).isValid).toBe(false);
    expect(
      (await validateYAML('typo: retained', 0, [...path, 'properties', 'customer'], true)).warnings,
    ).toEqual([expect.objectContaining({ type: 'unknown-schema-keyword', path: '/typo' })]);
  });

  it('reports unknown keywords and unchecked references when a partial block contains only their value', async () => {
    const { path } = documentWithSchema(fields[0], {});
    for (const suffix of [['typo'], ['0'], ['properties', 'customer', 'typo']]) {
      const result = await validateYAML('retained', 3, [...path, ...suffix], true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        expect.objectContaining({ type: 'unknown-schema-keyword', path: '/', line: 3 }),
      ]);
    }
    expect(
      (await validateYAML('https://example.invalid/type', 0, [...path, '$ref'], true)).warnings,
    ).toEqual([expect.objectContaining({ type: 'schema-reference-unchecked', path: '/' })]);
    const arrayItem = await validateYAML('type: string', 0, [...path, 'items', '0'], true);
    expect(arrayItem).toEqual({ isValid: true, errors: [], warnings: [] });
  });

  it('preserves definitions and propagates warnings through the public aggregation API', async () => {
    const { data, path } = documentWithSchema(fields[0], { type: 'string', typo: true });
    const content = `<!--@srs\n${stringify(data)}@srs-->`;
    const project = await createCoreApi().aggregateDocuments([{ path: 'srs.md', content }]);
    expect(project.aggregate.srs).toEqual(data);
    expect(project.aggregate.validation.errors).toEqual([]);
    expect(project.aggregate.validation.warnings).toEqual([
      expect.objectContaining({
        field: [...path, 'typo'].join('.'),
        path: 'srs.md',
        line: expect.any(Number),
      }),
    ]);
  });
});

describe('Interface protocol agreement in the Schema itself', () => {
  const combinations = Object.keys(protocols).flatMap((outer) =>
    Object.keys(protocols).map((inner) => ({ outer, inner })),
  );
  it.each(combinations)('$outer with definition.type $inner', async ({ outer, inner }) => {
    const data = documentWithContract(outer, protocols[inner]);
    const contract = {
      interface_id: 'create',
      version: '1.0.0',
      interface_type: outer,
      definition: protocols[inner],
    };
    const validate = standalone.getSchema(`${architectureId}#/definitions/interfaceContract`)!;
    expect(validate(contract)).toBe(outer === inner);
    const result = await validateExtendedSRS(data);
    expect(result.isValid).toBe(outer === inner);
    if (outer !== inner) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: [...contractPath, 'definition', 'type'].join('.'),
          type: 'const',
        }),
      );
    }
  });
});

describe('Open configuration maps', () => {
  it.each([
    ['httpApiInterface', 'headers', { 'Content-Type': 'application/json', 'x-trace': 'on' }],
    [
      'performancePolicies',
      'caching_strategy/properties/cache_headers',
      { 'Cache-Control': 'no-store' },
    ],
  ])('validates string header values in %s', (definition, field, value) => {
    const validate = fieldValidator(definition as string, field as string);
    expect(validate(value)).toBe(true);
    expect(validate({ 'x-count': 3 })).toBe(false);
  });

  it('accepts template-defined configuration keys while requiring an object per environment', async () => {
    const data = {
      manifest: { format: 'extended-srs/v1', project_name: 'Environment settings' },
      'development-implementation': {
        deployment_details: {
          infrastructure_templates: {
            environment_overrides: {
              production: {
                replicas: 3,
                enabled: true,
                region: 'local',
                options: { names: ['a'], empty: null },
              },
            },
          },
        },
      },
    };
    expect((await validateExtendedSRS(data)).isValid).toBe(true);
    const path = [
      'development-implementation',
      'deployment_details',
      'infrastructure_templates',
      'environment_overrides',
    ];
    expect((await validateYAML('production: 3', 0, path, true)).isValid).toBe(false);
  });
});
