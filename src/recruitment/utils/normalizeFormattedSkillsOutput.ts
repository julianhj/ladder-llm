/**
 * Deterministic cleanup for Skill Formatter (`formatted_skills`) output:
 * merge duplicate skill category keys after metadata strip, and dedupe section title recommendations.
 */

import { stripSkillHeadingMetadata } from './stripSkillHeadingMetadata.js';

export interface SectionTitleRecommendationInput {
  section_kind?: string;
  recommended_section_title?: string;
  previous_section_title?: string;
}

export interface SectionTitleRecommendation {
  section_kind: string;
  recommended_section_title: string;
  previous_section_title?: string;
}

function mergeFormattedSkillValues(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set(a.map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean));
    const out = [...a.map((x) => String(x ?? '').trim()).filter(Boolean)];
    for (const x of b) {
      const s = String(x ?? '').trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }
  if (
    a &&
    typeof a === 'object' &&
    !Array.isArray(a) &&
    b &&
    typeof b === 'object' &&
    !Array.isArray(b)
  ) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const itemsA = Array.isArray(ao.items) ? (ao.items as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    const itemsB = Array.isArray(bo.items) ? (bo.items as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    if (itemsA.length > 0 || itemsB.length > 0) {
      const mergedItems = mergeFormattedSkillValues(itemsA, itemsB) as string[];
      return { ...ao, ...bo, items: mergedItems };
    }
    const na = String(ao.narrative ?? '').trim();
    const nb = String(bo.narrative ?? '').trim();
    if (na && nb) {
      return { ...ao, narrative: `${na} ${nb}`.trim() };
    }
    return na ? { ...ao } : { ...bo };
  }
  return b !== undefined ? b : a;
}

/**
 * Collapse `skills_formatted` record keys that normalize to the same heading after metadata strip.
 */
export function normalizeSkillsFormattedRecord(
  skillsFormatted: Record<string, unknown>
): Record<string, unknown> {
  const merged = new Map<string, unknown>();
  const canonicalByNorm = new Map<string, string>();

  for (const [rawKey, value] of Object.entries(skillsFormatted)) {
    const cleaned = stripSkillHeadingMetadata(String(rawKey ?? '')).trim() || String(rawKey ?? '').trim();
    if (!cleaned) continue;
    const norm = cleaned.toLowerCase();

    if (canonicalByNorm.has(norm)) {
      const key = canonicalByNorm.get(norm)!;
      merged.set(key, mergeFormattedSkillValues(merged.get(key), value));
    } else {
      canonicalByNorm.set(norm, cleaned);
      merged.set(cleaned, value);
    }
  }

  return Object.fromEntries(merged.entries());
}

/**
 * Keep one recommendation per (section_kind, previous_section_title); last wins.
 */
export function dedupeSectionTitleRecommendations(
  recs: SectionTitleRecommendationInput[]
): SectionTitleRecommendation[] {
  const out: SectionTitleRecommendation[] = [];
  const indexByKey = new Map<string, number>();

  for (const r of recs) {
    const kind = String(r.section_kind ?? '').trim().toLowerCase();
    const title = String(r.recommended_section_title ?? '').trim();
    if (!kind || !title) continue;
    const prevRaw = r.previous_section_title;
    const prevNorm = prevRaw != null ? String(prevRaw).trim().toLowerCase() : '';
    const key = `${kind}|${prevNorm}`;
    const entry: SectionTitleRecommendation = {
      section_kind: kind,
      recommended_section_title: title,
    };
    if (prevRaw != null && String(prevRaw).trim().length > 0) {
      entry.previous_section_title = String(prevRaw).trim();
    }
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
      out[idx] = entry;
    } else {
      indexByKey.set(key, out.length);
      out.push(entry);
    }
  }

  return out;
}

export type SkillGroupLike = { heading?: string; items?: string[]; narrative?: string };

/**
 * Merge skills `content.groups` entries that share the same normalized heading after metadata strip.
 */
export function mergeDuplicateSkillGroupsByHeading(groups: SkillGroupLike[]): void {
  if (!Array.isArray(groups) || groups.length === 0) return;

  const result: SkillGroupLike[] = [];
  const indexByNorm = new Map<string, number>();

  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const rawHeading = String(g.heading ?? '').trim();
    const cleaned = stripSkillHeadingMetadata(rawHeading).trim() || rawHeading;
    const norm = cleaned.toLowerCase();
    if (!norm) {
      result.push({ ...g, heading: cleaned || rawHeading });
      continue;
    }

    const existingIdx = indexByNorm.get(norm);
    if (existingIdx === undefined) {
      indexByNorm.set(norm, result.length);
      result.push({
        ...g,
        heading: cleaned || rawHeading,
        items: Array.isArray(g.items)
          ? g.items.map((x) => String(x ?? '').trim()).filter(Boolean)
          : g.items,
      });
    } else {
      const target = result[existingIdx];
      const mergedItems = mergeFormattedSkillValues(
        Array.isArray(target.items) ? target.items : [],
        Array.isArray(g.items) ? g.items : []
      ) as string[];
      target.items = mergedItems;
      const na = String(target.narrative ?? '').trim();
      const nb = String(g.narrative ?? '').trim();
      if (na && nb) {
        target.narrative = `${na} ${nb}`.trim();
      } else if (nb) {
        target.narrative = nb;
      }
    }
  }

  groups.length = 0;
  groups.push(...result);
}
