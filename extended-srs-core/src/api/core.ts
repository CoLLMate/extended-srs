// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { ExtendedSRSAggregator, type AggregatedExtendedSRS } from '../aggregation/aggregator';
import { createMetadataSummary } from '../aggregation/projectUtils';
import { extractYAMLBlocks, extractContentSections, parseYAMLBlock } from '../parsing/yamlParser';
import { ExtendedSRSTreeManager } from '../tree/manager';
import { containsElementById, findElementById } from '../rules/elementSearch';
import { getProjectState, getUnblockedElements, extractElements } from '../rules/project';
import { getWorkflowConfig } from '../rules/workflow';
import { planElementStatusChange } from '../rules/documents';
import { createReview, resolveReview, getReviewHistory } from '../rules/reviews';
import type {
  CoreApiV1,
  CoreDocument,
  CoreProject,
  ConsistencyResult,
  ElementDefinition,
} from './contracts';

async function aggregateDocuments(
  documents: readonly CoreDocument[],
  options: { allowStandalone?: boolean } = {},
): Promise<CoreProject> {
  let aggregate: AggregatedExtendedSRS;
  let ordered: CoreDocument[];
  if (options.allowStandalone && !documents.some((document) => document.path === 'srs.md')) {
    const tree = new ExtendedSRSTreeManager();
    tree.loadDocuments(
      documents.map((document) => ({ filepath: document.path, content: document.content })),
    );
    aggregate = {
      srs: tree.getTree().data,
      contributions: {},
      validation: {
        isComplete: false,
        missingFields: [],
        errors: tree.getTree().validationErrors.map((error) => ({
          level: 'error',
          message: error.message,
          path: error.locations![0].filepath,
          field: error.path,
        })),
        warnings: [],
        conflicts: [],
      },
    };
    ordered = [...documents];
  } else {
    const contents = new Map(
      documents.map((document) => [document.path, { content: document.content }]),
    );
    const files = documents.map((document) => ({
      ...document.info,
      path: document.path,
      name: document.info?.name ?? document.path.split('/').pop()!,
      is_directory: false,
      size: document.info?.size ?? 0,
      modified: document.info?.modified ?? '',
    }));
    aggregate = await new ExtendedSRSAggregator(contents, files).aggregate();
    const byPath = new Map(documents.map((document) => [document.path, document]));
    ordered = Object.keys(aggregate.contributions).map((name) => byPath.get(name)!);
  }
  return { aggregate, documents: ordered, metadata: createMetadataSummary(aggregate.srs) };
}

function findElement(project: CoreProject, elementId: string): ElementDefinition | undefined {
  const value = findElementById(project.aggregate.srs, elementId);
  if (!value) {
    return undefined;
  }
  const source_files = project.documents
    .filter((document) =>
      extractYAMLBlocks(document.content).some((block) => {
        const parsed = parseYAMLBlock(block);
        return !parsed.error && containsElementById(parsed.data, elementId);
      }),
    )
    .map((document) => document.path);
  return { value, status: typeof value.status === 'string' ? value.status : 'draft', source_files };
}

function extractConsistencyPairs(content: string, elementId?: string): ConsistencyResult {
  const blocks = extractYAMLBlocks(content);
  const sections = new Map(
    extractContentSections(content).map((section) => [section.startLine, section]),
  );
  const pairs = blocks.flatMap((block, index) => {
    const parsed = parseYAMLBlock(block);
    const section = sections.get(block.endLine + 1);
    if (
      parsed.error ||
      !parsed.data ||
      !Object.keys(parsed.data).length ||
      !section?.content.trim() ||
      (elementId && !containsElementById(parsed.data, elementId))
    ) {
      return [];
    }
    return [
      {
        index,
        yaml: parsed.data as unknown,
        yaml_raw: block.content.trim(),
        is_partial: !!block.isPartial,
        partial_path: block.path?.join('.'),
        markdown: section.content,
        headings: section.headings,
        yaml_lines: { start: block.startLine, end: block.endLine },
        markdown_lines: { start: section.startLine, end: section.endLine },
      },
    ];
  });
  return { total_yaml_blocks: blocks.length, total_pairs: pairs.length, pairs };
}

export function createCoreApi(): CoreApiV1 {
  return Object.freeze({
    apiVersion: 1,
    aggregateDocuments,
    findElement,
    extractConsistencyPairs,
    getProjectState,
    getUnblockedElements,
    getWorkflowConfig,
    extractElements,
    planElementStatusChange,
    createReview,
    resolveReview,
    getReviewHistory,
  });
}
