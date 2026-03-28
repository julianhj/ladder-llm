/**
 * Derive CV slices from structured_cv.sections for agent inputs.
 *
 * Config keys structuredCV.experience, structuredCV.skills, and structuredCV.summary_keywords
 * read only from sections (kind experience / skills / summary). Other structuredCV.* paths use
 * normal property access on structured_cv (e.g. header, sections).
 */

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

/** Some callers pass stringified JSON; normalize so section slicing sees `sections`. */
function normalizeStructuredCv(cv: unknown): unknown {
  if (typeof cv === 'string') {
    const t = cv.trim();
    if (!t) return cv;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return cv;
    }
  }
  return cv;
}

export type StructuredCvSkillsSliceGroup = {
  heading: string;
  items?: string[];
  /** Present when the CV uses narrative-style skill groups (Stage 15 / optimizer). */
  narrative?: string;
};

export type StructuredCvSkillsSlice = {
  categories?: Array<{ category_name: string; skills: string[] }>;
  groups?: StructuredCvSkillsSliceGroup[];
};

/** Build summary / skills / experience payloads from sections[].kind only. */
export function getStructuredCVSliceFromSections(cv: unknown, subpath: string): unknown {
  if (!cv || typeof cv !== 'object') return undefined;
  const cvObj = cv as Record<string, unknown>;
  const sections = Array.isArray(cvObj.sections) ? cvObj.sections : [];
  if (subpath === 'summary_keywords') {
    const summarySection = sections.find((s: unknown) => (s as Record<string, unknown>)?.kind === 'summary');
    const content =
      summarySection && typeof summarySection === 'object'
        ? (summarySection as Record<string, unknown>).content
        : undefined;
    if (content && typeof content === 'object') {
      const c = content as Record<string, unknown>;
      const text =
        typeof c.text === 'string'
          ? c.text
          : Array.isArray(c.blocks)
            ? (c.blocks as Array<{ text?: string }>).map((b) => b?.text ?? '').join(' ')
            : '';
      return text ? { text } : undefined;
    }
    return undefined;
  }
  if (subpath === 'skills') {
    const skillSections = sections.filter((s: unknown) => (s as Record<string, unknown>)?.kind === 'skills');
    const out: StructuredCvSkillsSlice = { categories: [], groups: [] };
    for (const sec of skillSections) {
      const content = (sec as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
      if (!content) continue;
      if (Array.isArray(content.categories)) {
        for (const cat of content.categories) {
          const c = cat as { category_name?: string; skills?: string[] };
          out.categories!.push({
            category_name: c.category_name ?? '',
            skills: Array.isArray(c.skills) ? c.skills : [],
          });
        }
      }
      if (Array.isArray(content.groups)) {
        for (const g of content.groups) {
          const gr = g as { heading?: string; items?: string[]; narrative?: string };
          const items = Array.isArray(gr.items) ? gr.items : [];
          const narrativeTrimmed =
            typeof gr.narrative === 'string' ? gr.narrative.trim() : '';
          const group: StructuredCvSkillsSliceGroup = {
            heading: gr.heading ?? '',
            items,
            ...(narrativeTrimmed.length > 0 ? { narrative: narrativeTrimmed } : {}),
          };
          out.groups!.push(group);
        }
      }
    }
    if ((out.categories?.length ?? 0) > 0 || (out.groups?.length ?? 0) > 0) return out;
    return undefined;
  }
  if (subpath === 'experience') {
    const expSections = sections.filter((s: unknown) => (s as Record<string, unknown>)?.kind === 'experience');
    const items: unknown[] = [];
    for (const sec of expSections) {
      const content = (sec as Record<string, unknown>)?.content as { items?: unknown[] } | undefined;
      const contentItems = content?.items;
      if (Array.isArray(contentItems)) items.push(...contentItems);
    }
    return items.length > 0 ? { items } : undefined;
  }
  return undefined;
}

const SECTIONS_ONLY_SUBPATHS = new Set(['experience', 'skills', 'summary_keywords']);

/**
 * Resolve one structuredCV.* segment for agent inputData. Experience, skills, and summary_keywords
 * come only from sections; all other subpaths are read from structured_cv (dot path).
 */
export function getStructuredCvFieldForAgentInput(cv: unknown, subpath: string): unknown {
  const root = normalizeStructuredCv(cv);
  if (SECTIONS_ONLY_SUBPATHS.has(subpath)) {
    return getStructuredCVSliceFromSections(root, subpath);
  }
  return getAtPath(root, subpath);
}
