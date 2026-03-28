import type { StructuredCV } from '../schemas/StructuredInputs.js';
import { validateStructuredCV } from '../utils/cvConverter.js';
import type { RecruitmentRequest } from '../recruitmentRequest.js';

export type RerunOptimizedCvParse =
  | { status: 'none' }
  | { status: 'valid'; structured: StructuredCV }
  | { status: 'invalid'; message: string };

/**
 * When rerun sends optimized_cv, parse string if needed and validate as StructuredCV.
 */
function tryStructuredCvFromRerunOptimizedCv(
  raw: unknown
): { ok: true; structured: StructuredCV } | { ok: false; message: string } {
  try {
    let candidate: unknown = raw;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t.length) return { ok: false, message: 'empty optimized_cv string' };
      candidate = JSON.parse(t);
    }
    if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, message: 'optimized_cv must be a JSON object' };
    }
    const structured = validateStructuredCV(candidate);
    return { ok: true, structured };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * When rerun includes `optimized_cv`, validate it as StructuredCV-shaped input.
 * Valid JSON is turned into deterministic prose and passed to the CV Extractor (not used as final structured_cv).
 */
export function parseRerunOptimizedCv(request: RecruitmentRequest): RerunOptimizedCvParse {
  if (request.is_rerun_with_updated_cv !== true || request.optimized_cv == null) {
    return { status: 'none' };
  }
  const t = tryStructuredCvFromRerunOptimizedCv(request.optimized_cv);
  if (t.ok) return { status: 'valid', structured: t.structured };
  return { status: 'invalid', message: t.message };
}
