// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
// Consumer contract: package entry points only, with the same browser-facing
// aggregation, parsing, validation and i18n access patterns as existing apps.
import {
  parseExtendedSRS,
  normalizeManifestFilePath,
  loadExtendedSRSSchema,
  getSchemaNodeForPath,
  type AggregatedExtendedSRS,
  type FileInfo,
} from 'extended-srs-core';
import { getCurrentLocale } from 'extended-srs-core/i18n';
import {
  createCoreApi,
  SRSRuleError,
  type CoreApiV1,
  type CoreDocument,
} from 'extended-srs-core/api';

export async function exercise() {
  const { ExtendedSRSAggregator, initializeExtendedSRSSchemas } = await import('extended-srs-core');
  await initializeExtendedSRSSchemas();
  const data = {
    manifest: { format: 'extended-srs/v1', project_name: 'Browser', files: [] },
    'functional-requirements': {
      requirements: [
        {
          req_id: 'FR-1',
          name: 'Portable',
          status: 'draft',
          unknown_field: 'keep',
          'x-notes': { nested: 'keep' },
        },
      ],
    },
  };
  const content = `<!--@srs\n${JSON.stringify(data)}\n@srs-->\n# Requirement\nPortable prose.\n`;
  const info: FileInfo = {
    path: 'srs.md',
    name: 'srs.md',
    is_directory: false,
    size: content.length,
    modified: '',
  };
  const aggregate: AggregatedExtendedSRS = await new ExtendedSRSAggregator(
    new Map([['srs.md', { content }]]),
    [info],
  ).aggregate();
  const api: CoreApiV1 = createCoreApi();
  const documents: readonly CoreDocument[] = [{ path: 'srs.md', content, info }];
  const project = await api.aggregateDocuments(documents);
  const change = api.planElementStatusChange(documents, { element_id: 'FR-1', action: 'approve' });
  const metadata = { id: 1, actor: 'browser', timestamp: '2026-10-28T00:00:00Z' };
  const review = api.createReview(
    aggregate.srs,
    { element_id: 'FR-1', gate_type: 'content' },
    metadata,
  );
  const decision = api.resolveReview(
    aggregate.srs,
    [review],
    { element_id: 'FR-1', review_id: 1 },
    'approved',
    metadata,
  );
  let invalidTransition = false;
  try {
    api.planElementStatusChange(documents, { element_id: 'FR-1', new_status: 'invalid' });
  } catch (error) {
    invalidTransition = error instanceof SRSRuleError;
  }
  return {
    sameAggregation: JSON.stringify(aggregate) === JSON.stringify(project.aggregate),
    manifestPath: normalizeManifestFilePath('./srs.md'),
    parsed: parseExtendedSRS(content)?.yamlBlocks?.length,
    schema: getSchemaNodeForPath(loadExtendedSRSSchema(), ['manifest']) !== null,
    unknownPath: getSchemaNodeForPath(loadExtendedSRSSchema(), [
      'functional-requirements',
      'requirements',
      'unknown_field',
    ]),
    unknownPreserved:
      aggregate.srs['functional-requirements'].requirements[0].unknown_field === 'keep',
    unknownReported: aggregate.validation.warnings.some(
      (warning) =>
        warning.field === 'functional-requirements.requirements.0.unknown_field' &&
        warning.message.includes('不明なプロパティ'),
    ),
    extensionPreserved:
      aggregate.srs['functional-requirements'].requirements[0]['x-notes'].nested === 'keep',
    locale: getCurrentLocale(),
    element: api.findElement(project, 'FR-1')?.status,
    ready: api.getUnblockedElements(aggregate.srs).elements[0].ready_for,
    status: change.new_status,
    review: api.getReviewHistory([decision.review])[0].status,
    pairs: api.extractConsistencyPairs(content).total_pairs,
    invalidTransition,
  };
}
