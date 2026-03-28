/**
 * Deterministically fold candidate-selected missing skills into a structured CV's skills section.
 * Shared by Stage 15 CV optimizer post-process (and any code that merges skills into structured CV in-process).
 */

import type { StructuredCV } from '../schemas/StructuredInputs.js';
import {
  collectSkillsFromOptimizedCv,
  type SkillRepresentationMode,
} from './skillRepresentation.js';

export type TargetSeniorityClass =
  | 'entry'
  | 'intermediate'
  | 'senior'
  | 'lead'
  | 'manager'
  | 'head'
  | 'executive'
  | 'unknown'
  | string;

export interface MergeSelectedMissingSkillsOptions {
  skillMode?: SkillRepresentationMode;
  /** From Stage 13 / pipeline; drives narrative clause templates. */
  targetSeniorityClass?: TargetSeniorityClass;
}

const SENIOR_PLUS = new Set(['senior', 'lead', 'head', 'executive']);
const ENTRY_LIKE = new Set(['entry', 'intermediate', 'unknown']);

function tokenizeForMatch(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+.#]+/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 || t === 'go' || t === 'c#')
  );
}

function scoreGroupMatch(
  skillTokens: Set<string>,
  group: { heading?: string; narrative?: string; items?: string[] }
): number {
  const blob = [
    String(group.heading ?? ''),
    String(group.narrative ?? ''),
    ...(Array.isArray(group.items) ? group.items : []).map((i) => String(i)),
  ].join(' ');
  const groupTokens = tokenizeForMatch(blob);
  let score = 0;
  for (const st of skillTokens) {
    if (groupTokens.has(st)) score += 2;
  }
  const headingLower = String(group.heading ?? '').toLowerCase();
  for (const st of skillTokens) {
    if (st.length > 2 && headingLower.includes(st)) score += 3;
  }
  return score;
}

/**
 * Prefer an existing skills group whose heading, narrative, or items overlap the skill phrase.
 */
function findBestExistingGroupHeading(
  skill: string,
  groups: Array<{ heading?: string; items?: string[]; narrative?: string }>
): string | null {
  const skillTokens = tokenizeForMatch(skill);
  if (skillTokens.size === 0) return null;
  let best: { heading: string; score: number } | null = null;
  for (const g of groups) {
    const h = String(g?.heading ?? '').trim();
    if (!h) continue;
    const sc = scoreGroupMatch(skillTokens, g);
    if (sc >= 4 && (!best || sc > best.score)) {
      best = { heading: h, score: sc };
    }
  }
  return best?.heading ?? null;
}

function toNarrativeSkillSentence(skill: string, seniorityClass?: string): string {
  const cleaned = String(skill ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  if (/[.!?]\s*$/.test(cleaned)) {
    return cleaned.endsWith('.') || cleaned.endsWith('!') || cleaned.endsWith('?') ? cleaned : `${cleaned}.`;
  }
  if (/\bexpertise\.?\s*$/i.test(cleaned)) {
    return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
  }
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const isLongPhrase = wordCount >= 5 || cleaned.length >= 42;
  const cls = String(seniorityClass ?? 'unknown').toLowerCase();

  if (isLongPhrase) {
    if (ENTRY_LIKE.has(cls)) {
      return `Exposure to ${cleaned}.`;
    }
    if (SENIOR_PLUS.has(cls) || cls === 'manager') {
      return `Depth across ${cleaned}.`;
    }
    return `Familiarity with ${cleaned}.`;
  }

  if (ENTRY_LIKE.has(cls)) {
    return `Practical experience with ${cleaned}.`;
  }
  if (cls === 'executive' || cls === 'head') {
    return `Executive-level command of ${cleaned}.`;
  }
  if (SENIOR_PLUS.has(cls) || cls === 'manager') {
    return `Strong command of ${cleaned}.`;
  }
  return `Practical experience with ${cleaned}.`;
}

function getCategoryNameForSkill(skill: string): string {
  const lower = skill.toLowerCase();
  if (/\b(dora|metric|quantif|slo|sli|kpi|okr|measurement)\b/.test(lower)) {
    return 'Measurement and delivery';
  }
  if (/\b(enterprise transformation|operating model|business transformation)\b/.test(lower)) {
    return 'Strategy and transformation';
  }
  if (/\b(regulated delivery|regulatory delivery)\b/.test(lower)) {
    return 'Governance and delivery';
  }
  if (
    lower.includes('management') ||
    lower.includes('leadership') ||
    lower.includes('succession') ||
    lower.includes('stakeholder') ||
    (lower.includes('budget') && !lower.includes('typescript'))
  ) {
    return 'Leadership and Management';
  }
  if (
    lower.includes('security') ||
    lower.includes('compliance') ||
    lower.includes('regulatory') ||
    lower.includes('risk') ||
    lower.includes('audit')
  ) {
    return 'Security and Compliance';
  }
  if (
    lower.includes('frontend') ||
    lower.includes('mobile') ||
    (lower.includes('web') && !lower.includes('webpack')) ||
    lower.includes('ui') ||
    lower.includes('ux')
  ) {
    return 'Product and Delivery';
  }
  if (
    lower.includes('sla') ||
    lower.includes('slo') ||
    lower.includes('sli') ||
    (lower.includes('incident') && !lower.includes('typescript')) ||
    (lower.includes('operations') && !lower.includes('gitops'))
  ) {
    return 'Operations';
  }
  if (
    lower.includes('typescript') ||
    lower.includes('javascript') ||
    lower.includes('node') ||
    lower.includes('python') ||
    lower.includes('java') ||
    lower.includes('api') ||
    lower.includes('backend')
  ) {
    return 'Technical Skills';
  }
  if (lower.includes('delivery') || lower.includes('transformation')) {
    return 'Delivery and transformation';
  }
  return 'Additional capabilities';
}

function normalizeSkillGroupItems(
  groups: Array<{ heading?: string; items?: string[]; narrative?: string }>
): void {
  for (const group of groups) {
    if (!Array.isArray(group.items)) continue;
    const cleaned = group.items
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
    const seen = new Set<string>();
    group.items = cleaned.filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

/**
 * If any skills group uses a non-empty narrative, treat the CV as narrative mode for merges.
 * Otherwise keyword / items mode.
 */
export function inferSkillRepresentationModeForStructuredCv(cv: StructuredCV): SkillRepresentationMode {
  const root = cv as unknown as Record<string, unknown>;
  const sections = root.sections;
  if (!Array.isArray(sections)) return 'keywords';

  const skillsSection = sections.find(
    (s: unknown) =>
      s &&
      typeof s === 'object' &&
      !Array.isArray(s) &&
      String((s as Record<string, unknown>).kind ?? '').trim() === 'skills'
  ) as Record<string, unknown> | undefined;

  const content = skillsSection?.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return 'keywords';

  let groups = content.groups as Array<{ narrative?: string; items?: string[] }> | undefined;
  if (!Array.isArray(groups) || groups.length === 0) {
    const categories = content.categories as Array<unknown> | undefined;
    if (!Array.isArray(categories) || categories.length === 0) return 'keywords';
  }

  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (g && String(g.narrative ?? '').trim().length > 0) return 'narrative';
    }
  }

  return 'keywords';
}

/**
 * Ensure a skills section with `content.groups` exists; normalise categories → groups when needed.
 * Mutates `cv` in place (same rules as CV optimizer post-process).
 */
export function ensureSkillsSectionWithGroups(cv: Record<string, unknown>): void {
  let sectionsRaw = cv.sections;
  if (!Array.isArray(sectionsRaw)) {
    sectionsRaw = [];
    cv.sections = sectionsRaw;
  }
  const sections = sectionsRaw as unknown[];

  let skillsSectionIndex = sections.findIndex(
    (section: unknown) =>
      section &&
      typeof section === 'object' &&
      !Array.isArray(section) &&
      String((section as Record<string, unknown>).kind ?? '').trim() === 'skills'
  );

  let skillsSection: Record<string, unknown> | undefined =
    skillsSectionIndex >= 0 ? (sections[skillsSectionIndex] as Record<string, unknown>) : undefined;

  if (!skillsSection) {
    skillsSection = {
      id: `section-${sections.length + 1}`,
      section_title: 'Skills',
      kind: 'skills',
      content: { groups: [{ heading: 'Skills', items: [] }] },
    };
    sections.push(skillsSection);
  }

  const content = skillsSection.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    skillsSection.content = { groups: [{ heading: 'Skills', items: [] }] };
    return;
  }

  let groups = content.groups as Array<{ heading?: string; items?: string[]; narrative?: string }> | undefined;
  if (!Array.isArray(groups) || groups.length === 0) {
    const categories = content.categories as
      | Array<{ category_name?: string; name?: string; skills?: unknown[] }>
      | undefined;
    if (Array.isArray(categories) && categories.length > 0) {
      groups = categories.map((c) => ({
        heading:
          typeof (c?.category_name ?? c?.name) === 'string'
            ? String(c?.category_name ?? c?.name)
            : 'Skills',
        items: Array.isArray(c?.skills) ? c.skills.map((s) => String(s ?? '')) : [],
      }));
      content.groups = groups;
      delete content.categories;
    } else {
      groups = [{ heading: 'Skills', items: [] }];
      content.groups = groups;
    }
  }
  normalizeSkillGroupItems(groups);
}

/**
 * Merge normalised selected missing skills into the structured CV. Mutates `structuredCv`.
 * @returns list of skill strings that were newly added (for logging / changes_made)
 */
export function mergeSelectedMissingSkillsIntoStructuredCv(
  structuredCv: StructuredCV,
  selectedMissingSkills: string[],
  options?: MergeSelectedMissingSkillsOptions
): string[] {
  if (!selectedMissingSkills.length) return [];

  const skillMode = options?.skillMode ?? inferSkillRepresentationModeForStructuredCv(structuredCv);
  const seniorityForNarrative = options?.targetSeniorityClass;
  const cv = structuredCv as unknown as Record<string, unknown>;
  ensureSkillsSectionWithGroups(cv);

  const sections = cv.sections as unknown[] | undefined;
  if (!Array.isArray(sections)) return [];

  const skillsSection = sections.find(
    (s: unknown) =>
      s &&
      typeof s === 'object' &&
      !Array.isArray(s) &&
      String((s as Record<string, unknown>).kind ?? '').trim() === 'skills'
  ) as Record<string, unknown> | undefined;

  const content = skillsSection?.content as Record<string, unknown> | undefined;
  const contentGroups = content?.groups as
    | Array<{ heading?: string; items?: string[]; narrative?: string }>
    | undefined;
  if (!Array.isArray(contentGroups)) return [];

  const existingFromWholeCvItems = new Set(
    collectSkillsFromOptimizedCv(cv).map((skill) => String(skill ?? '').trim().toLowerCase()).filter(Boolean)
  );
  const existingNarrativeSentences = new Set(
    contentGroups
      .map((g) => String(g?.narrative ?? '').trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
  const existingKeywordItems = new Set(
    contentGroups
      .flatMap((g) => (Array.isArray(g.items) ? g.items : []))
      .map((b) => String(b).trim().toLowerCase())
      .filter((b) => b.length > 0)
  );

  const addedSkills: string[] = [];

  for (const selectedSkill of selectedMissingSkills) {
    const normalized = selectedSkill.trim();
    if (!normalized) continue;
    const fromExisting = findBestExistingGroupHeading(normalized, contentGroups);
    const targetHeading = fromExisting ?? getCategoryNameForSkill(normalized);
    const keywordItem = normalized;
    const keywordDedupeKey = keywordItem.toLowerCase();
    const narrativeSentence = toNarrativeSkillSentence(normalized, seniorityForNarrative);
    const narrativeDedupeKey = narrativeSentence.toLowerCase();
    if (
      existingKeywordItems.has(keywordDedupeKey) ||
      existingFromWholeCvItems.has(keywordDedupeKey) ||
      existingNarrativeSentences.has(narrativeDedupeKey)
    ) {
      continue;
    }
    let targetGroup = contentGroups.find(
      (g) => String(g?.heading ?? '').trim().toLowerCase() === targetHeading.toLowerCase()
    );
    if (!targetGroup) {
      targetGroup = { heading: targetHeading, items: [] };
      contentGroups.push(targetGroup);
    }
    if (!Array.isArray(targetGroup.items)) {
      targetGroup.items = [];
    }
    if (skillMode === 'narrative') {
      const existingNarrative = String(targetGroup.narrative ?? '').trim();
      targetGroup.narrative = existingNarrative
        ? `${existingNarrative} ${narrativeSentence}`.trim()
        : narrativeSentence;
      existingNarrativeSentences.add(narrativeDedupeKey);
    } else {
      targetGroup.items.push(keywordItem);
      existingKeywordItems.add(keywordDedupeKey);
    }
    existingFromWholeCvItems.add(keywordDedupeKey);
    addedSkills.push(normalized);
  }

  return addedSkills;
}
