/**
 * Evidence extraction layer — deterministic extraction from structured CV and JD.
 * Links signals to verbatim excerpts. No LLM calls (v1).
 */

import type { StructuredCV } from '../../schemas/StructuredInputs.js';
import type { StructuredJobDescription } from '../../schemas/StructuredInputs.js';

export interface EvidenceItem {
  signal_key: string;
  source_type: 'cv' | 'job_description';
  source_section: string;
  excerpt: string;
  confidence: number;
}

/** Keywords per signal key (deterministic match); keys aligned with schemas/signals/* */
const KEYWORDS_BY_SIGNAL: Record<string, string[]> = {
  'execution.delivery_consistency': ['delivery', 'delivered', 'shipped', 'execution', 'executed'],
  'execution.execution_maturity': ['delivery', 'operating', 'rhythm', 'planning', 'governance'],
  'execution.technical': ['technical', 'architecture', 'system', 'platform', 'engineering'],
  'leadership.scope_level': ['lead', 'led', 'leadership', 'scope', 'director', 'head of'],
  'leadership.leadership_strength': ['team', 'managed', 'management', 'coaching', 'mentor'],
  'leadership.leadership': ['leadership', 'strategy', 'strategic', 'vision'],
  'business.business_alignment': ['business', 'revenue', 'customer', 'enterprise', 'commercial'],
  'business.culture': ['culture', 'collaboration', 'stakeholder', 'cross-functional'],
  'seniority.scope_level': ['scope', 'org', 'organization', 'program', 'portfolio'],
  'seniority.team_scope': ['team', 'teams', 'direct reports', 'organisation'],
  'seniority.delivery_complexity': ['complex', 'complexity', 'scale', 'global', 'multi'],
  'risk.delivery_risk': ['risk', 'mitigation', 'governance', 'compliance'],
};

const DEFAULT_CONFIDENCE = 50;
const MATCH_CONFIDENCE = 75;

function excerpt(s: string, maxLen: number = 200): string {
  const t = (s ?? '').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '...';
}

function findMatchingSignalKeys(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  for (const [signalKey, keywords] of Object.entries(KEYWORDS_BY_SIGNAL)) {
    if (keywords.some(kw => lower.includes(kw))) matches.push(signalKey);
  }
  return matches;
}

/** Extract summary text from a summary section content (text or blocks). */
function summarySectionToText(content: Record<string, unknown>): string {
  if (typeof content.text === 'string' && content.text.trim()) return content.text.trim();
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  return blocks
    .filter((b): b is Record<string, unknown> => b != null && typeof b === 'object')
    .filter((b) => b.type === 'paragraph' && typeof b.text === 'string')
    .map((b) => String(b.text).trim())
    .filter(Boolean)
    .join('\n');
}

/** Extract skills text from a skills section content (categories, groups, or blocks). */
function skillsSectionToText(content: Record<string, unknown>): string {
  const categories = Array.isArray(content.categories) ? content.categories : [];
  if (categories.length > 0) {
    return categories
      .map((c) => {
        const r = c as Record<string, unknown>;
        const categoryName = typeof r.category_name === 'string' ? r.category_name : typeof r.name === 'string' ? r.name : '';
        const skills = Array.isArray(r.skills)
          ? (r.skills as string[])
          : [];
        return [categoryName, ...skills].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' ');
  }
  const groups = Array.isArray(content.groups) ? content.groups : [];
  if (groups.length > 0) {
    return groups
      .map((g) => {
        const row = g as Record<string, unknown>;
        const heading = typeof row.heading === 'string' ? row.heading.trim() : '';
        const items = Array.isArray(row.items) ? (row.items as string[]).map((i) => String(i ?? '').trim()).filter(Boolean) : [];
        const narrative = typeof row.narrative === 'string' ? row.narrative.trim() : '';
        return [heading, ...items, narrative].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' ');
  }
  const blocks = Array.isArray(content.blocks) ? content.blocks : [];
  return blocks
    .filter((b): b is Record<string, unknown> => b != null && typeof b === 'object')
    .filter((b) => b.type === 'paragraph' && typeof b.text === 'string')
    .map((b) => String(b.text).trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Deterministic extraction: walk CV sections and JD structured fields, emit EvidenceItem[]
 * for each snippet that matches a signal key. Excerpt is verbatim (trimmed, length-capped).
 */
export function buildEvidence(
  structured_cv: StructuredCV | Record<string, unknown> | null | undefined,
  structured_job_description: StructuredJobDescription | Record<string, unknown> | null | undefined
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const dedupe = new Set<string>();
  const pushEvidence = (item: EvidenceItem): void => {
    const dedupeKey = `${item.signal_key}|${item.source_type}|${item.source_section}|${item.excerpt}`;
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);
    items.push(item);
  };

  if (structured_cv && typeof structured_cv === 'object' && Array.isArray(structured_cv.sections)) {
    for (const section of structured_cv.sections) {
      if (!section || typeof section !== 'object' || typeof (section as Record<string, unknown>).kind !== 'string') continue;
      const kind = (section as Record<string, unknown>).kind as string;
      const content = ((section as Record<string, unknown>).content ?? {}) as Record<string, unknown>;

      if (kind === 'summary') {
        const text = summarySectionToText(content);
        if (text) {
          const keys = findMatchingSignalKeys(text);
          for (const key of keys) {
            pushEvidence({
              signal_key: key,
              source_type: 'cv',
              source_section: 'summary',
              excerpt: excerpt(text),
              confidence: MATCH_CONFIDENCE,
            });
          }
        }
      } else if (kind === 'skills') {
        const text = skillsSectionToText(content);
        if (text) {
          const keys = findMatchingSignalKeys(text);
          for (const key of keys) {
            pushEvidence({
              signal_key: key,
              source_type: 'cv',
              source_section: 'skills',
              excerpt: excerpt(text),
              confidence: DEFAULT_CONFIDENCE,
            });
          }
        }
      } else if (kind === 'experience') {
        const expItems = Array.isArray(content.items) ? content.items : [];
        for (const e of expItems) {
          const row = (e ?? {}) as Record<string, unknown>;
          const role = typeof row.role === 'string' ? row.role.trim() : typeof row.position === 'string' ? row.position.trim() : '';
          const company = typeof row.company === 'string' ? row.company.trim() : '';
          const period = typeof row.period === 'string' ? row.period.trim() : typeof row.duration === 'string' ? row.duration.trim() : '';
          const tags = Array.isArray(row.tags) ? (row.tags as string[]).map((t) => String(t ?? '').trim()).filter(Boolean) : [];
          const responsibilities = Array.isArray(row.responsibilities) ? (row.responsibilities as string[]) : Array.isArray(row.highlights) ? (row.highlights as string[]) : [];
          const description = typeof row.description === 'string' ? row.description.trim() : '';
          const parts = [role, company, period, ...tags, ...responsibilities, description].filter(Boolean);
          const text = parts.join(' ');
          if (!text) continue;
          const keys = findMatchingSignalKeys(text);
          for (const key of keys) {
            pushEvidence({
              signal_key: key,
              source_type: 'cv',
              source_section: 'experience',
              excerpt: excerpt(text),
              confidence: MATCH_CONFIDENCE,
            });
          }
        }
      }
    }
  }

  if (structured_job_description && typeof structured_job_description === 'object') {
    const jd = structured_job_description as Record<string, unknown>;

    const evidenceArr = jd.evidence as Array<{ supports?: string; quote?: string; source_section?: string }> | undefined;
    if (Array.isArray(evidenceArr)) {
      for (const e of evidenceArr) {
        const quote = (e.quote ?? '').trim() || (e.supports ?? '').trim();
        if (!quote) continue;
        const keys = findMatchingSignalKeys(quote);
        for (const key of keys) {
          pushEvidence({
            signal_key: key,
            source_type: 'job_description',
            source_section: (e.source_section as string) ?? 'evidence',
            excerpt: excerpt(quote),
            confidence: MATCH_CONFIDENCE,
          });
        }
      }
    }

    const responsibilities = jd.responsibilities as string[] | undefined;
    if (Array.isArray(responsibilities)) {
      const text = responsibilities.join(' ');
      const keys = findMatchingSignalKeys(text);
      for (const key of keys) {
        pushEvidence({
          signal_key: key,
          source_type: 'job_description',
          source_section: 'responsibilities',
          excerpt: excerpt(text),
          confidence: DEFAULT_CONFIDENCE,
        });
      }
    }

    const req = jd.required_skills as { categories?: Array<{ category_name?: string; name?: string; skills?: string[] }> } | undefined;
    if (req?.categories) {
      for (const cat of req.categories) {
        const text = [(cat.category_name ?? cat.name ?? ''), ...(cat.skills ?? [])].join(' ');
        const keys = findMatchingSignalKeys(text);
        for (const key of keys) {
          pushEvidence({
            signal_key: key,
            source_type: 'job_description',
            source_section: 'required_skills',
            excerpt: excerpt(text),
            confidence: DEFAULT_CONFIDENCE,
          });
        }
      }
    }
  }

  return items;
}
