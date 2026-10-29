// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { findElementById } from './elementSearch';
import { SRSRuleError } from './errors';
import { assertWorkflowTransition, getWorkflowConfig, type WorkflowContext } from './workflow';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import architectureSchema from '../../schema/schemas/system-architecture-schema.json';
import commonSchema from '../../schema/schemas/common-definitions-schema.json';

const interfaceAjv = new Ajv({ strict: false });
addFormats(interfaceAjv);
interfaceAjv.addSchema(
  commonSchema,
  'https://exsrs.org/extended-srs/v1/schemas/common-definitions-schema.json',
);
interfaceAjv.addSchema(architectureSchema);
const validateInterface = interfaceAjv.getSchema(
  `${architectureSchema.$id}#/definitions/interfaceContract`,
)!;
// Element extraction configuration per SRS section
interface ElementSource {
  sectionKey: string;
  itemsPath: (section: any) => any[] | undefined;
  idField: string;
  elementType: string;
}

const ELEMENT_SOURCES: ElementSource[] = [
  {
    sectionKey: 'use-cases',
    itemsPath: (s) => s?.list,
    idField: 'uc_id',
    elementType: 'use-case',
  },
  {
    sectionKey: 'functional-requirements',
    itemsPath: (s) => s?.requirements,
    idField: 'req_id',
    elementType: 'functional-requirement',
  },
  {
    sectionKey: 'non-functional-requirements',
    itemsPath: (s) => s?.list,
    idField: 'req_id',
    elementType: 'non-functional-requirement',
  },
  {
    sectionKey: 'system-architecture',
    itemsPath: (s) => {
      const modules: any[] = [];
      s?.architecture?.key_components?.components?.forEach((comp: any) => {
        comp?.modules?.forEach((mod: any) => {
          modules.push({ ...mod, _component_id: comp.component_id });
        });
      });
      return modules.length > 0 ? modules : undefined;
    },
    idField: 'module_id',
    elementType: 'module',
  },
  {
    sectionKey: 'development-implementation',
    itemsPath: (s) => s?.development_milestones?.milestones,
    idField: 'milestone_id',
    elementType: 'milestone',
  },
];

/**
 * A single dependency edge, normalized to the typed form defined in
 * ``common-definitions-schema.json``. Bare string IDs from the YAML are
 * lifted to ``{ ref_id }`` with no ``ref_type`` / ``dependency_type`` set,
 * so downstream callers can rely on a consistent shape.
 */
export interface TypedDependency {
  ref_id: string;
  ref_type?: string;
  dependency_type?: 'hard' | 'soft' | 'interface';
}

export interface ProjectElement {
  element_id: string;
  element_type: string;
  name: string;
  status: string;
  priority?: string;
  /**
   * Dependencies expressed in the typed form. Raw string entries are lifted
   * to ``{ ref_id }`` with no type information, preserving whatever the
   * YAML author actually wrote (including ``dependency_type`` for
   * hard/soft/interface distinctions used by scheduling logic).
   */
  depends_on: TypedDependency[];
  blocks: string[];
  pending_review: boolean;
}

/**
 * Normalize ``depends_on`` entries to a uniform typed shape. The raw YAML
 * may hold either strings or ``{ ref_id, ref_type?, dependency_type? }``
 * objects (per common-definitions schema); both are normalized to
 * ``TypedDependency``. Strings lose no information because they never
 * carried type metadata in the first place.
 */
function normalizeDependsOn(dependsOn: any[] | undefined): TypedDependency[] {
  if (!dependsOn || !Array.isArray(dependsOn)) {
    return [];
  }
  const out: TypedDependency[] = [];
  for (const dep of dependsOn) {
    if (typeof dep === 'string') {
      out.push({ ref_id: dep });
      continue;
    }
    if (dep && typeof dep === 'object' && typeof dep.ref_id === 'string') {
      const entry: TypedDependency = { ref_id: dep.ref_id };
      if (typeof dep.ref_type === 'string') {
        entry.ref_type = dep.ref_type;
      }
      if (
        dep.dependency_type === 'hard' ||
        dep.dependency_type === 'soft' ||
        dep.dependency_type === 'interface'
      ) {
        entry.dependency_type = dep.dependency_type;
      }
      out.push(entry);
    }
  }
  return out;
}

/**
 * Extract all elements from aggregated SRS data
 */
export function extractElements(srs: any): ProjectElement[] {
  const elements: ProjectElement[] = [];

  for (const source of ELEMENT_SOURCES) {
    const section = srs?.[source.sectionKey];
    if (!section) {
      continue;
    }

    const items = source.itemsPath(section);
    if (!items || !Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const id = item[source.idField];
      if (typeof id !== 'string' || !id) {
        continue;
      }

      const status = item.status || 'draft';
      elements.push({
        element_id: id,
        element_type: source.elementType,
        name: item.name || item.title || id,
        status,
        priority: item.priority,
        depends_on: normalizeDependsOn(item.depends_on),
        blocks: [],
        pending_review: status === 'tentative' || status === 'in_review',
      });
    }
  }

  return elements;
}

/**
 * Build reverse dependency map (blocks) from forward dependencies.
 *
 * All dependency types (hard / soft / interface / untyped) contribute
 * to the reverse mapping — blocking is a structural relation, while the
 * dependency_type only affects how scheduling interprets it.
 */
function computeBlocks(elements: ProjectElement[]): void {
  const byId = new Map<string, ProjectElement>();
  for (const el of elements) {
    byId.set(el.element_id, el);
  }

  for (const el of elements) {
    for (const dep of el.depends_on) {
      const target = byId.get(dep.ref_id);
      if (target && !target.blocks.includes(el.element_id)) {
        target.blocks.push(el.element_id);
      }
    }
  }
}

/** Evidence supplied by the host for dependencies outside the SRS document. */
export interface DependencyEvidence {
  completed?: readonly string[];
  interfaces?: readonly string[];
}

function validateEvidence(evidence: DependencyEvidence): void {
  if (
    !evidence ||
    typeof evidence !== 'object' ||
    Array.isArray(evidence) ||
    Object.entries(evidence).some(
      ([key, value]) =>
        !['completed', 'interfaces'].includes(key) ||
        !Array.isArray(value) ||
        value.some((id) => typeof id !== 'string' || !id),
    )
  ) {
    throw new SRSRuleError(
      'Invalid dependency_evidence: completed/interfaces must be arrays of element ids',
    );
  }
}

/** common-definitions §1.3 / main specification III.2: hard means completed. */
export function unmetDependencies(
  srs: any,
  element: ProjectElement,
  evidence: DependencyEvidence = {},
): TypedDependency[] {
  validateEvidence(evidence);
  return unmetFromIndex(srs, element, evidence, indexElements(extractElements(srs)));
}

function indexElements(elements: readonly ProjectElement[]): Map<string, ProjectElement[]> {
  const index = new Map<string, ProjectElement[]>();
  for (const element of elements) {
    index.set(element.element_id, [...(index.get(element.element_id) ?? []), element]);
  }
  return index;
}

function unmetFromIndex(
  srs: any,
  element: ProjectElement,
  evidence: DependencyEvidence,
  index: Map<string, ProjectElement[]>,
): TypedDependency[] {
  return element.depends_on.filter((dep) => {
    if (dep.dependency_type === 'soft') {
      return false;
    }
    const target = index
      .get(dep.ref_id)
      ?.find((candidate) => !dep.ref_type || candidate.element_type === dep.ref_type);
    if (dep.dependency_type === 'interface') {
      if (evidence.interfaces?.includes(dep.ref_id)) {
        return false;
      }
      const definition = target && findElementById(srs, target.element_id);
      // The module schema supplies actual interface contracts. An arbitrary
      // referenced id (or a completed element) alone does not prove a contract.
      return (
        !Array.isArray(definition?.provided_interfaces) ||
        !definition.provided_interfaces.some((contract) => validateInterface(contract))
      );
    }
    if (target) {
      return target.status !== 'implemented' && target.status !== 'verified';
    }
    // Missing references are unresolved, not implicitly completed externals.
    return !evidence.completed?.includes(dep.ref_id);
  });
}

export function getProjectState(srs: any, filterStatus?: readonly string[]) {
  let elements = extractElements(srs);
  computeBlocks(elements);
  if (filterStatus?.length) {
    elements = elements.filter((element) => filterStatus.includes(element.status));
  }
  const counts = new Map<string, number>();
  for (const element of elements) {
    counts.set(element.status, (counts.get(element.status) ?? 0) + 1);
  }
  return { elements, summary: { total: elements.length, by_status: Object.fromEntries(counts) } };
}

export type WorkType = 'spec' | 'impl' | 'verify';

export function getUnblockedElements(
  srs: any,
  workType?: string,
  evidence: DependencyEvidence = {},
  context: WorkflowContext = {},
) {
  getWorkflowConfig(srs);
  validateEvidence(evidence);
  if (workType !== undefined && !['spec', 'impl', 'verify'].includes(workType)) {
    throw new SRSRuleError(`Invalid work_type "${workType}"`);
  }
  const phase: Record<string, WorkType> = {
    draft: 'spec',
    approved: 'impl',
    blocked: 'impl',
    implemented: 'verify',
  };
  const priority: Record<string, number> = {
    must: 0,
    high: 0,
    should: 1,
    medium: 1,
    could: 2,
    low: 2,
    wont: 3,
  };
  const allElements = extractElements(srs);
  const index = indexElements(allElements);
  const elements = allElements.flatMap((element) => {
    const ready = Object.prototype.hasOwnProperty.call(phase, element.status)
      ? phase[element.status]
      : undefined;
    if (
      !ready ||
      (workType && ready !== workType) ||
      unmetFromIndex(srs, element, evidence, index).length
    ) {
      return [];
    }
    // Implementation begins with a state transition. Specification writing
    // and verification work precede their approval gates, so those gates must
    // not hide the work needed to produce the evidence for approval.
    if (ready === 'impl') {
      try {
        assertWorkflowTransition(srs, element.element_id, element.status, 'in_progress', context);
      } catch (error) {
        if (error instanceof SRSRuleError) {
          return [];
        }
        throw error;
      }
    }
    return [
      {
        element_id: element.element_id,
        name: element.name,
        status: element.status,
        priority: element.priority,
        ready_for: ready,
      },
    ];
  });
  const rank = (value: string | undefined) =>
    value && Object.prototype.hasOwnProperty.call(priority, value) ? priority[value] : 99;
  elements.sort((a, b) => rank(a.priority) - rank(b.priority));
  return { elements };
}
