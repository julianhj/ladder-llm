import type { AgentResult } from '../PipelineRunner.js';
import type { MergeOutputsCombineConfig } from '../../loaders/ConfigLoader.js';
import type { CandidateProfile } from '../../agents/schemas/index.js';
import { CVOptimizationResultSchema } from '../../agents/schemas/index.js';
import { normalizeOptimizedCvForValidation } from '../../agents/stage_15_final_decision/normalizer.js';
import { Logger } from '../../utils/Logger.js';
import { buildOptimizedCvSectionsForStage15Merge } from './buildOptimizedCvSectionsFromAuthoritativeSources.js';

function isFieldRef(val: unknown): val is { from: string; field: string } {
  return (
    val != null &&
    typeof val === 'object' &&
    'from' in (val as object) &&
    'field' in (val as object) &&
    typeof (val as Record<string, unknown>).from === 'string' &&
    typeof (val as Record<string, unknown>).field === 'string'
  );
}

function getAtPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

/**
 * Merges Stage 9 parallel agent results into a single CVOptimizationResult using the combine config.
 * Resolves output map: each key maps to { from: agentId | "input", field: fieldName }.
 * Builds optimized_cv: section list from structured_cv (or rewriter shell if empty), with skills and
 * experience content taken only from skill_representation_formatter and experience_representation_formatter.
 */
export function mergeStage3Outputs(
  agentResults: AgentResult[],
  mergeConfig: MergeOutputsCombineConfig,
  candidateProfile: CandidateProfile | null
): unknown {
  const byAgentId = new Map<string, Record<string, unknown>>();
  for (const r of agentResults) {
    if (!r.success || r.result == null || typeof r.result !== 'object') continue;
    byAgentId.set(r.agentId, r.result as Record<string, unknown>);
  }

  const output = mergeConfig.output;
  const merged: Record<string, unknown> = {};

  for (const [outKey, spec] of Object.entries(output)) {
    if (!isFieldRef(spec)) continue;

    const { from: source, field } = spec;
    let value: unknown;

    if (source === 'input') {
      if (candidateProfile && field === 'previous_optimized_cv_hash') {
        value = candidateProfile.previous_optimized_cv_hash ?? undefined;
      } else if (candidateProfile && field.startsWith('structuredCV.')) {
        value = getAtPath(candidateProfile.structured_cv, field.replace(/^structuredCV\./, ''));
      } else {
        value = candidateProfile ? getAtPath(candidateProfile, field) : undefined;
      }
    } else {
      const agentResult = byAgentId.get(source);
      if (!agentResult) {
        // For optimized_cv_sections, still build optimized_cv from structured CV + formatter outputs
        // even when section rewriter output is missing.
        if (outKey !== 'optimized_cv_sections') continue;
      } else {
        value = field ? agentResult[field] : agentResult;
        // Section Rewriter may use sections_rewritten as alias for rewritten_sections
        if (value === undefined && (field === 'rewritten_sections' || field === 'sections_rewritten')) {
          value = agentResult.rewritten_sections ?? agentResult.sections_rewritten;
        }
      }
    }

    if (outKey === 'optimized_cv_sections') {
      const rewriterSections = Array.isArray(value) ? value : [];
      const structuredSections = getAtPath(candidateProfile?.structured_cv, 'sections') as unknown[] | undefined;
      const skillFormatter = byAgentId.get('skill_representation_formatter') as Record<string, unknown> | undefined;
      const experienceFormatter = byAgentId.get('experience_representation_formatter') as Record<string, unknown> | undefined;
      const sections = buildOptimizedCvSectionsForStage15Merge(
        structuredSections,
        rewriterSections,
        skillFormatter,
        experienceFormatter
      );
      const structuredCv = candidateProfile?.structured_cv as Record<string, unknown> | undefined;
      // structured_cv is always section-based (header + sections).
      const cvHeader = structuredCv?.header as { full_name?: string; professional_title?: string; contact?: Record<string, string> } | undefined;
      const full_name = (cvHeader?.full_name ?? candidateProfile?.name ?? '').trim() || (candidateProfile?.name ?? '');
      const professional_title = (cvHeader?.professional_title ?? (candidateProfile?.role_applying_for ?? '')).trim();
      const contact: Record<string, string> = { ...(cvHeader?.contact ?? {}) };
      if (candidateProfile?.email && !contact.email) contact.email = candidateProfile.email;
      const header =
        full_name || professional_title || Object.keys(contact).length > 0
          ? { full_name, professional_title, contact: Object.keys(contact).length > 0 ? contact : undefined }
          : undefined;
      merged.optimized_cv = { header, sections };
      continue;
    }

    if (value !== undefined && value !== null) {
      merged[outKey] = value;
    }
  }

  // Ensure required CVOptimizationResult fields with defaults
  if (!Array.isArray(merged.changes_made)) merged.changes_made = [];
  if (!Array.isArray(merged.rationale) || merged.rationale.length === 0) {
    merged.rationale = [{ heading: 'Summary', summary: 'CV optimization completed.' }];
  }
  if (merged.ats_optimization === undefined || merged.ats_optimization === null) {
    merged.ats_optimization = '';
  }
  // Role Fit agent outputs keyword_enhancements as a Section object (see RoleFitSummarySchema), not string[].
  // Only default when absent; do not replace objects with [].
  if (merged.keyword_enhancements === undefined || merged.keyword_enhancements === null) {
    merged.keyword_enhancements = [];
  }
  if (!Array.isArray(merged.missing_skills)) merged.missing_skills = [];

  // Normalize optimized_cv so sections match CVDisplaySectionSchema (filter non-objects, kind/content shape, type→kind, merge list sections).
  if (
    merged.optimized_cv != null &&
    typeof merged.optimized_cv === 'object' &&
    !Array.isArray(merged.optimized_cv)
  ) {
    normalizeOptimizedCvForValidation(merged.optimized_cv as Record<string, unknown>);
  }

  const parsed = CVOptimizationResultSchema.safeParse(merged);
  if (parsed.success) {
    return parsed.data;
  }
  const flat = parsed.error.flatten();
  Logger.warn('PipelineRunner', 'Stage 9 merge validation failed, returning best-effort merged object', {
    formErrors: flat.formErrors,
    fieldErrors: flat.fieldErrors,
    validationErrorsSummary: JSON.stringify(flat),
    mergedKeys: Object.keys(merged),
  });
  return merged;
}
