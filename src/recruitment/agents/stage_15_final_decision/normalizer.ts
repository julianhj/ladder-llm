import { stripSkillHeadingMetadata } from '../../utils/stripSkillHeadingMetadata.js';
import { cvListItemToDisplayString } from '../../utils/cvListItemToDisplayString.js';

const SECTION_KINDS = new Set(['summary', 'skills', 'experience', 'education', 'certifications', 'awards', 'list', 'rich_text', 'custom']);

function normalizeDashCharacters(text: string): string {
  return text.replace(/[–—]/g, '-');
}

/** True if content is an array of blocks (paragraph/list) from section_rewriter. */
function isBlockArray(content: unknown): content is Array<Record<string, unknown>> {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => b != null && typeof b === 'object' && typeof (b as Record<string, unknown>).type === 'string');
}

/** Extract paragraph text and list items from blocks into description string and highlights array (for experience fallback). */
function blocksToExperienceFallback(blocks: Array<Record<string, unknown>>): { description: string; highlights: string[] } {
  const descriptionParts: string[] = [];
  const highlights: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph' && typeof b.text === 'string') {
      const t = (b.text as string).trim();
      if (t) descriptionParts.push(t);
    }
    if (b.type === 'list' && Array.isArray(b.items)) {
      for (const item of b.items) {
        const s = String(item ?? '').trim();
        if (s) highlights.push(s);
      }
    }
  }
  return { description: descriptionParts.join('\n\n'), highlights };
}

interface SourceExperienceEntry {
  company: string;
  role: string;
  period: string;
  tags: string[];
  experience_style?: 'narrative' | 'bullets' | 'both';
}

interface OptimizedExperienceEntry {
  company?: string;
  position?: string;
  duration?: string;
  description?: string;
  responsibilities?: string[];
}

export interface ExperienceRepairResult {
  sourceExperienceCount: number;
  optimizedExperienceCountBeforeRepair: number;
  optimizedExperienceCountAfterRepair: number;
  recoveredEntries: Array<{ company: string; role: string }>;
}

function normalizeExperienceKeyPart(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildExperienceKeys(company: string, role: string, period: string): string[] {
  const keys: string[] = [];
  if (company && role && period) keys.push(`${company}|${role}|${period}`);
  if (company && role) keys.push(`${company}|${role}|`);
  if (company && period) keys.push(`${company}||${period}`);
  if (role && period) keys.push(`|${role}|${period}`);
  if (company) keys.push(`${company}||`);
  if (company && !role && !period) keys.push(`${company}|only|`);
  if (role && !company) keys.push(`|${role}|`);
  return Array.from(new Set(keys));
}

function parseSourceExperienceEntries(sourceExperience: unknown): SourceExperienceEntry[] {
  if (!Array.isArray(sourceExperience)) return [];
  return sourceExperience
    .filter((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const company = String(row.company ?? '').trim();
      const role = String(row.role ?? row.position ?? '').trim();
      const period = String(row.period ?? row.duration ?? '').trim();
      const tags = Array.isArray(row.tags)
        ? row.tags.map((tag) => String(tag ?? '').trim()).filter((tag) => tag.length > 0)
        : [];
      const rawStyle = row.experience_style;
      const experience_style: SourceExperienceEntry['experience_style'] =
        rawStyle === 'narrative' || rawStyle === 'bullets' || rawStyle === 'both' ? rawStyle : undefined;
      return { company, role, period, tags, experience_style };
    })
    .filter((entry) => entry.company.length > 0 || entry.role.length > 0 || entry.period.length > 0);
}

function parseOptimizedExperienceEntries(items: unknown): OptimizedExperienceEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const responsibilities = Array.isArray(row.responsibilities)
        ? row.responsibilities.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
        : undefined;
      return {
        company: typeof row.company === 'string' ? row.company : undefined,
        position: typeof row.position === 'string' ? row.position : undefined,
        duration: typeof row.duration === 'string' ? row.duration : undefined,
        description: typeof row.description === 'string' ? row.description : undefined,
        responsibilities,
      };
    });
}

function sourceToOptimizedExperienceEntry(source: SourceExperienceEntry): OptimizedExperienceEntry {
  const normalizedTags = Array.from(
    new Set(
      source.tags
        .map((tag) => normalizeDashCharacters(String(tag ?? '').trim()))
        .filter((tag) => tag.length > 0)
    )
  );
  const style = source.experience_style;
  const descriptionFromTags = normalizedTags.length > 0 ? normalizedTags.join('. ') : undefined;

  if (style === 'narrative') {
    return {
      company: source.company ? normalizeDashCharacters(source.company) : undefined,
      position: source.role ? normalizeDashCharacters(source.role) : undefined,
      duration: source.period ? normalizeDashCharacters(source.period) : undefined,
      description: descriptionFromTags,
      responsibilities: undefined,
    };
  }
  if (style === 'both') {
    return {
      company: source.company ? normalizeDashCharacters(source.company) : undefined,
      position: source.role ? normalizeDashCharacters(source.role) : undefined,
      duration: source.period ? normalizeDashCharacters(source.period) : undefined,
      description: descriptionFromTags,
      responsibilities: normalizedTags.length > 0 ? normalizedTags : undefined,
    };
  }
  // bullets (and any other style): include description from tags so the UI always has a summary line.
  // Previously we only set responsibilities for bullets, which omitted description and looked like missing content (especially for senior roles often written as bullets).
  return {
    company: source.company ? normalizeDashCharacters(source.company) : undefined,
    position: source.role ? normalizeDashCharacters(source.role) : undefined,
    duration: source.period ? normalizeDashCharacters(source.period) : undefined,
    description: descriptionFromTags,
    responsibilities: normalizedTags.length > 0 ? normalizedTags : undefined,
  };
}

export function reconcileOptimizedExperienceEntries(
  optimizedCv: Record<string, unknown>,
  sourceExperience: unknown
): ExperienceRepairResult {
  const parsedSourceEntries = parseSourceExperienceEntries(sourceExperience);
  const sourceExperienceCount = parsedSourceEntries.length;
  const emptyResult: ExperienceRepairResult = {
    sourceExperienceCount,
    optimizedExperienceCountBeforeRepair: 0,
    optimizedExperienceCountAfterRepair: 0,
    recoveredEntries: [],
  };

  const sections = optimizedCv.sections;
  if (!Array.isArray(sections)) return emptyResult;

  let experienceSection = sections.find(
    (section) => section && typeof section === 'object' && !Array.isArray(section) && (section as Record<string, unknown>).kind === 'experience'
  ) as Record<string, unknown> | undefined;

  if (!experienceSection) {
    if (parsedSourceEntries.length === 0) {
      return emptyResult;
    }
    experienceSection = {
      id: `section-${sections.length + 1}`,
      title: 'Experience',
      kind: 'experience',
      content: { items: [] },
    };
    sections.push(experienceSection);
  }

  if (!experienceSection.content || typeof experienceSection.content !== 'object' || Array.isArray(experienceSection.content)) {
    experienceSection.content = { items: [] };
  }

  const content = experienceSection.content as Record<string, unknown>;
  const optimizedEntries = parseOptimizedExperienceEntries(content.items);
  const optimizedExperienceCountBeforeRepair = optimizedEntries.length;

  if (parsedSourceEntries.length === 0) {
    return {
      sourceExperienceCount: 0,
      optimizedExperienceCountBeforeRepair,
      optimizedExperienceCountAfterRepair: optimizedEntries.length,
      recoveredEntries: [],
    };
  }

  const keyToOptimizedIndexes = new Map<string, number[]>();
  optimizedEntries.forEach((entry, index) => {
    const keys = buildExperienceKeys(
      normalizeExperienceKeyPart(entry.company),
      normalizeExperienceKeyPart(entry.position),
      normalizeExperienceKeyPart(entry.duration)
    );
    for (const key of keys) {
      const arr = keyToOptimizedIndexes.get(key);
      if (arr) {
        arr.push(index);
      } else {
        keyToOptimizedIndexes.set(key, [index]);
      }
    }
  });

  const usedOptimizedIndexes = new Set<number>();
  const merged: OptimizedExperienceEntry[] = [];
  const recoveredEntries: Array<{ company: string; role: string }> = [];

  for (const sourceEntry of parsedSourceEntries) {
    const keys = buildExperienceKeys(
      normalizeExperienceKeyPart(sourceEntry.company),
      normalizeExperienceKeyPart(sourceEntry.role),
      normalizeExperienceKeyPart(sourceEntry.period)
    );
    let matchedIndex: number | undefined;
    for (const key of keys) {
      const candidates = keyToOptimizedIndexes.get(key);
      if (!candidates || candidates.length === 0) continue;
      const available = candidates.find((candidateIndex) => !usedOptimizedIndexes.has(candidateIndex));
      if (available != null) {
        matchedIndex = available;
        break;
      }
    }

    if (matchedIndex != null) {
      usedOptimizedIndexes.add(matchedIndex);
      merged.push(optimizedEntries[matchedIndex]);
      continue;
    }

    recoveredEntries.push({
      company: sourceEntry.company || 'Unknown company',
      role: sourceEntry.role || 'Unknown role',
    });
    merged.push(sourceToOptimizedExperienceEntry(sourceEntry));
  }

  optimizedEntries.forEach((entry, index) => {
    if (!usedOptimizedIndexes.has(index)) {
      merged.push(entry);
    }
  });

  content.items = merged;

  return {
    sourceExperienceCount,
    optimizedExperienceCountBeforeRepair,
    optimizedExperienceCountAfterRepair: merged.length,
    recoveredEntries,
  };
}

function normalizeDashCharactersDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeDashCharacters(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = normalizeDashCharactersDeep(value[i]);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = normalizeDashCharactersDeep(obj[key]);
    }
  }
  return value;
}

export function normalizeOptimizedCvForValidation(optimizedCv: Record<string, unknown>): void {
  normalizeDashCharactersDeep(optimizedCv);

  const sections = optimizedCv.sections;
  if (!Array.isArray(sections)) return;

  const seenIds = new Set<string>();
  const normalizedSections: Array<Record<string, unknown>> = [];

  for (let i = 0; i < sections.length; i += 1) {
    const sourceSection = sections[i];
    if (!sourceSection || typeof sourceSection !== 'object' || Array.isArray(sourceSection)) continue;
    const section = sourceSection as Record<string, unknown>;

    // Section Rewriter or other callers may use "type" instead of "kind" for the discriminator.
    const rawKind =
      (typeof section.kind === 'string' ? section.kind : typeof section.type === 'string' ? section.type : '')
        .trim();
    const kind = SECTION_KINDS.has(rawKind) ? rawKind : 'custom';
    const rawTitle =
      (typeof section.section_title === 'string' ? section.section_title : typeof section.title === 'string' ? section.title : '')
        .trim();
    const sectionTitle = rawTitle || `Section ${i + 1}`;

    let id = typeof section.id === 'string' ? section.id.trim() : '';
    if (!id || seenIds.has(id)) {
      id = `section-${i + 1}`;
      while (seenIds.has(id)) id = `${id}-dup`;
    }
    seenIds.add(id);

    const meta = section.meta && typeof section.meta === 'object' && !Array.isArray(section.meta)
      ? section.meta
      : undefined;

    const content = section.content;
    let normalizedContent: unknown;

    if (kind === 'summary') {
      if (typeof content === 'string') {
        normalizedContent = { text: content };
      } else if (Array.isArray(content) && content.length > 0 && content.every((b) => b != null && typeof b === 'object' && !Array.isArray(b) && typeof (b as Record<string, unknown>).type === 'string')) {
        // Section Rewriter / API may send summary content as array of blocks (e.g. [{ type: 'paragraph', text: '...' }]).
        normalizedContent = { blocks: content };
      } else if (content && typeof content === 'object' && !Array.isArray(content)) {
        const contentObj = content as Record<string, unknown>;
        const blocks = contentObj.blocks;
        if (Array.isArray(blocks) && blocks.length > 0) {
          normalizedContent = { blocks };
        } else {
          const text = typeof contentObj.text === 'string' ? contentObj.text : '';
          normalizedContent = { text };
        }
      } else {
        normalizedContent = { text: '' };
      }
    } else if (kind === 'skills') {
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        const contentObj = content as Record<string, unknown>;
        const groups = contentObj.groups;
        if (Array.isArray(groups) && groups.length > 0) {
          normalizedContent = {
            groups: groups
              .filter((g) => g && typeof g === 'object' && !Array.isArray(g))
              .map((g) => {
                const row = g as Record<string, unknown>;
                const rawHeading = typeof row.heading === 'string' ? row.heading : '';
                return {
                  heading: rawHeading ? stripSkillHeadingMetadata(rawHeading) : '',
                  items: Array.isArray(row.items) ? row.items.map((i) => String(i ?? '')) : undefined,
                  narrative: typeof row.narrative === 'string' ? row.narrative : undefined,
                };
              }),
          };
        } else {
          const contentRecord = content as Record<string, unknown>;
          const blocks = contentRecord.blocks;
          if (Array.isArray(blocks) && blocks.length > 0) {
            normalizedContent = { blocks };
          } else {
            const categories = contentRecord.categories;
            normalizedContent = {
              categories: Array.isArray(categories)
                ? categories
                    .filter((category) => category && typeof category === 'object' && !Array.isArray(category))
                    .map((category) => {
                      const categoryObj = category as Record<string, unknown>;
                      const rawCat =
                        typeof categoryObj.category_name === 'string'
                          ? categoryObj.category_name
                          : typeof (categoryObj as Record<string, unknown>).name === 'string'
                            ? (categoryObj as Record<string, unknown>).name
                            : 'Skills';
                      return {
                        category_name: stripSkillHeadingMetadata(String(rawCat)),
                        skills: Array.isArray(categoryObj.skills)
                          ? categoryObj.skills.map((skill) => String(skill ?? '')).filter((skill) => skill.trim().length > 0)
                          : [],
                      };
                    })
                : [],
            };
          }
        }
      } else {
        normalizedContent = { categories: [] };
      }
    } else if (kind === 'experience' || kind === 'education' || kind === 'certifications' || kind === 'awards') {
      let items: unknown[] | undefined;
      if (Array.isArray(content)) {
        items = content;
      } else if (content && typeof content === 'object' && !Array.isArray(content)) {
        items = (content as Record<string, unknown>).items as unknown[] | undefined;
      }
      const rawItems = Array.isArray(items) ? items : [];
      if (kind === 'experience') {
        // Section rewriter may send experience as array of blocks (paragraph/list). Convert to items+highlights so the frontend can display bullets.
        if (rawItems.length > 0 && isBlockArray(rawItems as Array<Record<string, unknown>>)) {
          const { description, highlights } = blocksToExperienceFallback(rawItems as Array<Record<string, unknown>>);
          normalizedContent = {
            items: [
              {
                company: '',
                role: '',
                position: '',
                period: '',
                duration: '',
                description: description || undefined,
                highlights,
                responsibilities: highlights,
              },
            ],
          };
        } else {
          normalizedContent = {
            items: rawItems.map((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
              const row = item as Record<string, unknown>;
              const role = String(row.role ?? row.position ?? '').trim();
              const position = String(row.position ?? row.role ?? '').trim();
              const period = String(row.period ?? row.duration ?? '').trim();
              const duration = String(row.duration ?? row.period ?? '').trim();
              // Preserve highlights (API) and responsibilities (legacy) so the frontend can display bullets
              const highlights = Array.isArray(row.highlights) ? row.highlights.map((h) => String(h ?? '').trim()).filter(Boolean) : undefined;
              const responsibilities = Array.isArray(row.responsibilities) ? row.responsibilities.map((r) => String(r ?? '').trim()).filter(Boolean) : undefined;
              const bullets = highlights ?? responsibilities ?? [];
              return {
                ...row,
                role: role || position,
                position: position || role,
                period: period || duration,
                duration: duration || period,
                highlights: bullets.length > 0 ? bullets : row.highlights,
                responsibilities: bullets.length > 0 ? bullets : row.responsibilities,
              };
            }),
          };
        }
      } else if (kind === 'education') {
        normalizedContent = { items: rawItems };
      } else {
        normalizedContent = {
          items: rawItems.map((item) => cvListItemToDisplayString(item)).filter((s) => s.length > 0),
        };
      }
    } else if (kind === 'list') {
      let rawListItems: unknown[] = [];
      if (Array.isArray(content)) {
        rawListItems = content;
      } else if (content && typeof content === 'object' && !Array.isArray(content)) {
        const items = (content as Record<string, unknown>).items;
        rawListItems = Array.isArray(items) ? items : [];
      }
      normalizedContent = {
        items: rawListItems.map((item) => cvListItemToDisplayString(item)).filter((s) => s.length > 0),
      };
    } else if (kind === 'rich_text') {
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        const blocks = (content as Record<string, unknown>).blocks;
        normalizedContent = { blocks: Array.isArray(blocks) ? blocks : [] };
      } else if (typeof content === 'string' && content.trim()) {
        normalizedContent = { blocks: [{ type: 'paragraph', text: content }] };
      } else {
        normalizedContent = { blocks: [] };
      }
    } else {
      if (content && typeof content === 'object' && !Array.isArray(content)) {
        normalizedContent = content;
      } else if (content == null) {
        normalizedContent = {};
      } else {
        normalizedContent = { value: content };
      }
    }

    const normalizedSection: Record<string, unknown> = {
      id,
      section_title: sectionTitle,
      kind,
      content: normalizedContent,
    };
    if (meta) normalizedSection.meta = meta;
    normalizedSections.push(normalizedSection);
  }

  // Remove model-invented "notes/gaps" sections that should never appear in final CV output.
  const looksLikeGapNotesSection = (sec: Record<string, unknown>): boolean => {
    const title = String(sec.section_title ?? sec.title ?? '').trim().toLowerCase();
    if (!title) return false;
    const titleSignals = [
      'additional notes',
      'evidence gaps',
      'needs evidence',
      'validation notes',
      'gaps',
    ];
    if (titleSignals.some((signal) => title.includes(signal))) return true;

    const content = sec.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== 'object') return false;
    const text = [
      typeof content.text === 'string' ? content.text : '',
      Array.isArray(content.items) ? content.items.map((item) => String(item ?? '')).join(' ') : '',
      Array.isArray(content.blocks)
        ? content.blocks
            .map((block) => (block && typeof block === 'object' ? String((block as Record<string, unknown>).text ?? '') : ''))
            .join(' ')
        : '',
    ]
      .join(' ')
      .toLowerCase();
    return text.includes('needs evidence') || text.includes('evidence gaps');
  };

  // Remove misplaced expertise: rich_text sections with only paragraph blocks (the "boxes below summary")
  // belong in skills as content.groups; strip them so the UI does not show them.
  const sectionsToMerge = normalizedSections.filter((sec) => {
    if (looksLikeGapNotesSection(sec)) return false;
    if (String(sec.kind ?? '').trim() !== 'rich_text') return true;
    const c = sec.content as Record<string, unknown> | undefined;
    const blocks = c != null && Array.isArray(c.blocks) ? c.blocks : [];
    if (blocks.length === 0) return true;
    const allParagraphs = blocks.every(
      (b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'paragraph'
    );
    return !allParagraphs; // drop paragraph-only rich_text (misplaced expertise)
  });

  // Merge duplicate Education / Certifications / Awards list sections (generic handling: one section per)
  const listSectionTitles = new Map<string, string>([
    ['education', 'Education'],
    ['certifications', 'Certifications'],
    ['awards', 'Awards'],
  ]);
  const merged: Array<Record<string, unknown>> = [];
  const listAccumulators = new Map<string, string[]>();

  for (const sec of sectionsToMerge) {
    const secKind = String(sec.kind ?? '').trim();
    const secTitle = String((sec as Record<string, unknown>).section_title ?? (sec as Record<string, unknown>).title ?? '').trim().toLowerCase();
    const content = sec.content as Record<string, unknown> | undefined;
    const items =
      content && Array.isArray(content.items)
        ? (content.items as unknown[]).map((item) => cvListItemToDisplayString(item)).filter(Boolean)
        : [];

    if (secKind === 'education' && content && Array.isArray(content.items)) {
      const educationItems = (content.items as unknown[]).map((item) => cvListItemToDisplayString(item)).filter(Boolean);
      const key = 'education';
      const arr = listAccumulators.get(key) ?? [];
      arr.push(...educationItems);
      listAccumulators.set(key, arr);
      continue;
    }
    if (secKind === 'certifications' && content && Array.isArray(content.items)) {
      const certItems = (content.items as unknown[]).map((item) => cvListItemToDisplayString(item)).filter(Boolean);
      const arr = listAccumulators.get('certifications') ?? [];
      arr.push(...certItems);
      listAccumulators.set('certifications', arr);
      continue;
    }
    if (secKind === 'awards' && content && Array.isArray(content.items)) {
      const awardItems = (content.items as unknown[]).map((item) => cvListItemToDisplayString(item)).filter(Boolean);
      const arr = listAccumulators.get('awards') ?? [];
      arr.push(...awardItems);
      listAccumulators.set('awards', arr);
      continue;
    }

    if (secKind === 'list') {
      let matchedKey: string | null = null;
      for (const key of listSectionTitles.keys()) {
        if (secTitle.includes(key)) {
          matchedKey = key;
          break;
        }
      }
      if (matchedKey) {
        const arr = listAccumulators.get(matchedKey) ?? [];
        arr.push(...items);
        listAccumulators.set(matchedKey, arr);
        continue;
      }
    }

    merged.push(sec);
  }

  const canonicalOrder = ['education', 'certifications', 'awards'];
  let listInsertIndex = merged.findIndex(
    (s) => String((s.kind as string) ?? '').trim() === 'experience'
  );
  if (listInsertIndex < 0) listInsertIndex = merged.length;

  for (const key of canonicalOrder) {
    const items = listAccumulators.get(key);
    if (!items || items.length === 0) continue;
    const deduped = Array.from(new Set(items));
    const title = listSectionTitles.get(key) ?? key;
    merged.splice(listInsertIndex, 0, {
      id: `section-${key}-${listInsertIndex}`,
      section_title: title,
      kind: 'list',
      content: { items: deduped },
    });
    listInsertIndex += 1;
  }

  if (merged.length > 0) {
    optimizedCv.sections = merged;
  }
}

/** Source structured_cv shape for injection (education/certifications/awards may be string[] or object[]). */
export interface SourceStructuredCvForInjection {
  education?: unknown[] | string[];
  certifications?: unknown[] | string[];
  awards?: unknown[] | string[];
}

function itemsFromSource(value: unknown[] | string[] | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value
    .map((item) => cvListItemToDisplayString(item))
    .filter((s) => s.trim().length > 0);
}

/**
 * Inject education, certifications, and awards sections from source structured_cv when they are missing
 * or empty in the optimized CV. Inserts after the experience section to match canonical order.
 */
export function injectMissingListSectionsFromSource(
  optimizedCv: Record<string, unknown>,
  sourceStructuredCv: SourceStructuredCvForInjection | undefined
): { injected: string[] } {
  const injected: string[] = [];
  if (!sourceStructuredCv) return { injected };

  const sections = optimizedCv.sections as unknown[] | undefined;
  if (!Array.isArray(sections)) return { injected };

  const hasSectionWithItems = (kindOrTitle: string, titleSubstring?: string): boolean => {
    for (const sec of sections) {
      if (!sec || typeof sec !== 'object' || Array.isArray(sec)) continue;
      const s = sec as Record<string, unknown>;
      const kind = String(s.kind ?? '').trim();
      const title = String((s.section_title ?? s.title) ?? '').trim().toLowerCase();
      const content = s.content as Record<string, unknown> | undefined;
      const items = content && Array.isArray(content.items) ? content.items : [];
      if (kind === kindOrTitle || (titleSubstring && title.includes(titleSubstring))) {
        if (items.length > 0) return true;
      }
    }
    return false;
  };

  const experienceIndex = sections.findIndex(
    (s) => s && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).kind === 'experience'
  );
  let insertIndex = experienceIndex >= 0 ? experienceIndex + 1 : sections.length;

  const toInject: Array<{ key: string; title: string; items: string[] }> = [];
  const educationItems = itemsFromSource(sourceStructuredCv.education);
  if (educationItems.length > 0 && !hasSectionWithItems('education', 'education')) {
    toInject.push({ key: 'education', title: 'Education', items: educationItems });
    injected.push('education');
  }
  const certItems = itemsFromSource(sourceStructuredCv.certifications);
  if (certItems.length > 0 && !hasSectionWithItems('certifications', 'certification')) {
    toInject.push({ key: 'certifications', title: 'Certifications', items: certItems });
    injected.push('certifications');
  }
  const awardItems = itemsFromSource(sourceStructuredCv.awards);
  if (awardItems.length > 0 && !hasSectionWithItems('awards', 'award')) {
    toInject.push({ key: 'awards', title: 'Awards', items: awardItems });
    injected.push('awards');
  }

  for (const { key, title, items } of toInject) {
    const newSection: Record<string, unknown> = {
      id: `section-${key}-from-source-${insertIndex}`,
      title,
      kind: 'list',
      content: { items: Array.from(new Set(items)) },
    };
    sections.splice(insertIndex, 0, newSection);
    insertIndex += 1;
  }

  return { injected };
}

export function normalizeCvOptimizationResultForOutput(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const payload = data as Record<string, unknown>;
  if (!payload.optimized_cv || typeof payload.optimized_cv !== 'object' || Array.isArray(payload.optimized_cv)) {
    // still normalize section_help even if optimized_cv is missing
  } else {
    normalizeOptimizedCvForValidation(payload.optimized_cv as Record<string, unknown>);
  }
  // Normalize section_help: model may return string, array of strings, or array of objects; frontend expects string values
  const sh = payload.section_help;
  if (sh != null && typeof sh === 'object' && !Array.isArray(sh)) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(sh)) {
      if (typeof value === 'string') {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        const parts = value.map((v) => {
          if (typeof v === 'string') return v;
          if (v != null && typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') return (v as { text: string }).text;
          return JSON.stringify(v);
        });
        normalized[key] = parts.filter(Boolean).join('\n\n').trim() || '';
      } else if (value != null && typeof value === 'object' && 'text' in value && typeof (value as { text: unknown }).text === 'string') {
        normalized[key] = (value as { text: string }).text;
      } else {
        normalized[key] = String(value ?? '');
      }
    }
    payload.section_help = normalized;
  }
  return payload;
}
