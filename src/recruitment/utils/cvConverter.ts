import { StructuredCVSchema } from '../schemas/StructuredInputs.js';
import type { StructuredCV } from '../schemas/StructuredInputs.js';
import { normalizeOptimizedCvForValidation } from '../agents/stage_15_final_decision/normalizer.js';

/**
 * Ensures each section has section_title (optimized_cv from Section Rewriter uses "title").
 * Mutates in place so StructuredCVSchema.parse can succeed before full normalization.
 */
function ensureSectionTitles(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const obj = input as Record<string, unknown>;
  const sections = obj.sections;
  if (!Array.isArray(sections)) return;
  sections.forEach((section: unknown, i: number) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return;
    const sec = section as Record<string, unknown>;
    if (sec.section_title !== undefined && typeof sec.section_title === 'string') return;
    const title = typeof sec.title === 'string' ? sec.title.trim() : '';
    sec.section_title = title || `Section ${i + 1}`;
  });
}

/**
 * Validates and normalizes input as StructuredCV (header + sections).
 * Used when rerunning with optimized_cv so the pipeline receives a valid section-based CV.
 * Optimized_cv sections may use "title" instead of "section_title"; we normalize before parse.
 */
export function validateStructuredCV(input: unknown): StructuredCV {
  const raw = input as Record<string, unknown>;
  const sections = Array.isArray(raw?.sections)
    ? raw.sections.map((s: unknown) => (s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : s))
    : raw?.sections;
  const copy = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? { ...raw, sections }
    : input;
  ensureSectionTitles(copy);
  const parsed = StructuredCVSchema.parse(copy) as StructuredCV & Record<string, unknown>;
  normalizeOptimizedCvForValidation(parsed);
  return parsed as StructuredCV;
}
