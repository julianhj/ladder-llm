/**
 * Skill representation mode: keyword-style (short tokens, ATS-friendly) vs narrative-style
 * (grouped capability clusters). Used to normalise and enforce format in CV Optimizer output.
 */

export type SkillRepresentationMode = 'keywords' | 'narrative';

const MAX_WORDS_KEYWORD = 6;
/** Split on comma, " and ", " & " first; then we may split long chunks on spaces. */
const PHRASE_SPLIT = /,\s*|\s+and\s+|\s*&\s*/gi;

/**
 * Normalise missing_skills list to match mode. Keywords: strip tier-3/diagnostics,
 * take first comma-separated part, trim. Narrative: return as-is.
 */
export function normalizeMissingSkills(
  skills: string[] | null | undefined,
  mode: SkillRepresentationMode
): string[] {
  if (!skills || !Array.isArray(skills)) return [];
  if (mode === 'narrative') return skills.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0);

  return skills
    .map((s) => {
      let t = String(s ?? '')
        .replace(/tier[- ]?3/gi, '')
        .replace(/diagnostics?/gi, '')
        .trim();
      const firstPart = t.split(',')[0]?.trim() ?? '';
      return firstPart;
    })
    .filter((s) => s.length > 0);
}

/**
 * Log a warning if keyword mode is used but sentence-like skills are present (observability only).
 */
export function validateSkillFormat(
  skills: string[],
  mode: SkillRepresentationMode
): void {
  if (mode !== 'keywords' || !skills.length) return;
  const sentenceLike = skills.filter((s) => s.split(/\s+/).length > MAX_WORDS_KEYWORD);
  if (sentenceLike.length > 0) {
    console.warn('Narrative skills detected in keyword mode', {
      sample: sentenceLike.slice(0, 3),
      count: sentenceLike.length,
    });
  }
}

/**
 * Split a long or sentence-like skill string into discrete tokens (comma, " and ", " & ";
 * if a chunk is still long, split on spaces).
 */
function tokeniseSkillItem(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks = trimmed.split(PHRASE_SPLIT).map((p) => p.trim()).filter((p) => p.length > 0);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).length;
    if (words > MAX_WORDS_KEYWORD) {
      const tokens = chunk.split(/\s+/).filter((t) => t.length > 0);
      for (const t of tokens) {
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(t);
      }
    } else {
      const key = chunk.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(chunk);
    }
  }
  return result;
}

/**
 * Mutate optimized_cv in place so skills sections match mode: keyword mode tokenises
 * long items; narrative mode leaves content as-is.
 */
export function enforceSkillsSectionFormat(
  optimizedCv: Record<string, unknown>,
  mode: SkillRepresentationMode
): void {
  const sections = optimizedCv?.sections;
  if (!Array.isArray(sections)) return;

  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    if (String(sec.kind ?? '').trim() !== 'skills') continue;

    const content = sec.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
    const contentObj = content as Record<string, unknown>;

    let groups: Array<Record<string, unknown>> = Array.isArray(contentObj.groups) ? (contentObj.groups as Array<Record<string, unknown>>) : [];
    if (groups.length === 0) {
      const categories = contentObj.categories;
      if (Array.isArray(categories) && categories.length > 0) {
        groups = categories.map((c: unknown) => {
          const cat = c as Record<string, unknown>;
          return {
            heading: typeof (cat?.category_name ?? cat?.name) === 'string' ? (cat?.category_name ?? cat?.name) : 'Skills',
            items: Array.isArray(cat?.skills) ? (cat.skills as string[]).map((s) => String(s ?? '')) : [],
          };
        });
        contentObj.groups = groups;
        delete contentObj.categories;
      } else {
        continue;
      }
    }

    for (const group of groups) {
      const g = group as Record<string, unknown>;
      let items = g.items;
      if (!Array.isArray(items)) continue;

      if (mode === 'keywords') {
        const result: string[] = [];
        for (const item of items) {
          const s = String(item ?? '').trim();
          if (!s) continue;
          const words = s.split(/\s+/).length;
          if (words > MAX_WORDS_KEYWORD) {
            const tokens = tokeniseSkillItem(s);
            result.push(...tokens);
          } else {
            result.push(s);
          }
        }
        const seen = new Set<string>();
        g.items = result.filter((it) => {
          const key = it.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      // narrative mode: leave groups as the model provided
    }
  }
}

/** Parsed seniority enforcement slice used to filter missing_skills lists. */
export interface SeniorityEnforcementSlice {
  inflation_risk?: number;
  candidate_seniority_class?: string;
  target_seniority_class?: string;
  seniority_gap?: string;
}

const SENIORITY_RANK: Record<string, number> = {
  entry: 1,
  intermediate: 2,
  senior: 3,
  lead: 4,
  manager: 4,
  head: 5,
  executive: 6,
  unknown: 2,
};

/**
 * When the candidate is far below target or inflation risk is high, drop long JD-shaped
 * missing_skills lines so the UI does not suggest copy that over-claims senior scope.
 */
export function filterMissingSkillsBySeniorityContext(
  missing: string[] | null | undefined,
  enforcement: SeniorityEnforcementSlice
): string[] {
  if (!missing || !Array.isArray(missing) || missing.length === 0) return [];
  const inf = typeof enforcement.inflation_risk === 'number' ? enforcement.inflation_risk : 0;
  const gapText = String(enforcement.seniority_gap ?? '').toLowerCase();
  const c = SENIORITY_RANK[String(enforcement.candidate_seniority_class ?? 'unknown').toLowerCase()] ?? 2;
  const t = SENIORITY_RANK[String(enforcement.target_seniority_class ?? 'unknown').toLowerCase()] ?? 2;
  const gapLevels = Math.max(0, t - c);
  const severeGap =
    gapLevels >= 2 ||
    inf >= 60 ||
    gapText.includes('below target') ||
    gapText.includes('material gap') ||
    gapText.includes('significant gap') ||
    gapText.includes('large gap');
  if (!severeGap) return missing.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0);
  return missing
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0)
    .filter((m) => m.split(/\s+/).filter(Boolean).length <= 5);
}

export function parseSeniorityEnforcementSlice(raw: string | undefined): SeniorityEnforcementSlice {
  if (raw == null || raw === '') return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      inflation_risk: typeof o.inflation_risk === 'number' ? o.inflation_risk : undefined,
      candidate_seniority_class:
        typeof o.candidate_seniority_class === 'string' ? o.candidate_seniority_class : undefined,
      target_seniority_class: typeof o.target_seniority_class === 'string' ? o.target_seniority_class : undefined,
      seniority_gap: typeof o.seniority_gap === 'string' ? o.seniority_gap : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Collect all skill strings from optimized_cv.sections (skills sections only) for validation.
 */
export function collectSkillsFromOptimizedCv(optimizedCv: Record<string, unknown>): string[] {
  const out: string[] = [];
  const sections = optimizedCv?.sections;
  if (!Array.isArray(sections)) return out;

  for (const section of sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const sec = section as Record<string, unknown>;
    if (String(sec.kind ?? '').trim() !== 'skills') continue;

    const content = sec.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;

    const groups = content.groups ?? content.categories;
    if (!Array.isArray(groups)) continue;

    for (const group of groups) {
      const g = group as Record<string, unknown>;
      const items = g.items ?? (g as { skills?: string[] }).skills;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const s = String(item ?? '').trim();
        if (s) out.push(s);
      }
    }
  }
  return out;
}
