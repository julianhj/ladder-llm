/**
 * Stage 15 merge: build optimized_cv.sections from authoritative inputs so the section rewriter
 * cannot change skills, experience, or other CV facts. Formatter outputs and structured_cv win.
 */


function sectionKind(sec: unknown): string {
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return '';
  const o = sec as Record<string, unknown>;
  return String(o.kind ?? o.type ?? '').trim();
}

export function buildSkillGroupsFromFormattedSkills(
  skillsFormatted: Record<string, unknown>,
  mode: 'keywords' | 'narrative'
): Array<{ heading: string; items?: string[]; narrative?: string }> {
  const groups: Array<{ heading: string; items?: string[]; narrative?: string }> = [];
  for (const [heading, raw] of Object.entries(skillsFormatted)) {
    if (mode === 'keywords') {
      const items = Array.isArray(raw)
        ? raw.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0)
        : [];
      groups.push({ heading, items, narrative: '' });
    } else {
      let narrative = '';
      if (typeof raw === 'string') {
        narrative = raw.trim();
      } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const n = (raw as Record<string, unknown>).narrative;
        narrative = typeof n === 'string' ? n.trim() : '';
      }
      groups.push({ heading, narrative, items: [] });
    }
  }
  return groups;
}

function cloneSections(sections: unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(sections)) as unknown[];
}

/**
 * Inject authoritative skills (skill formatter) and experience (experience formatter) into section list.
 * - When formatter data exists for a kind, replaces that section's content; drops extra same-kind sections after the first injected one.
 * - When formatter data is missing, keeps existing section content (pass-through).
 */
export function applyAuthoritativeSkillsAndExperienceToSections(
  sections: unknown[],
  skillFormatterResult: Record<string, unknown> | undefined,
  experienceFormatterResult: Record<string, unknown> | undefined
): void {
  const mode =
    skillFormatterResult?.skill_representation_mode === 'narrative' ? 'narrative' : 'keywords';
  const sfRaw = skillFormatterResult?.skills_formatted;
  const skillsFormatted =
    sfRaw != null && typeof sfRaw === 'object' && !Array.isArray(sfRaw)
      ? (sfRaw as Record<string, unknown>)
      : null;
  const hasSkillsPayload = skillsFormatted != null && Object.keys(skillsFormatted).length > 0;

  const expRows = Array.isArray(experienceFormatterResult?.experience_formatted)
    ? (experienceFormatterResult!.experience_formatted as Record<string, unknown>[])
    : null;
  const hasExpPayload = expRows != null && expRows.length > 0;

  let skillsApplied = false;
  let experienceApplied = false;
  const removeIndexes: number[] = [];

  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) continue;
    const s = sec as Record<string, unknown>;
    const kind = sectionKind(sec);

    if (kind === 'skills' && hasSkillsPayload) {
      if (!skillsApplied) {
        s.kind = 'skills';
        s.content = {
          groups: buildSkillGroupsFromFormattedSkills(skillsFormatted!, mode),
        };
        skillsApplied = true;
      } else {
        removeIndexes.push(i);
      }
      continue;
    }

    if (kind === 'experience' && hasExpPayload) {
      if (!experienceApplied) {
        s.kind = 'experience';
        s.content = {
          items: expRows!.map((row) => ({ ...row })),
        };
        experienceApplied = true;
      } else {
        removeIndexes.push(i);
      }
    }
  }

  for (let i = removeIndexes.length - 1; i >= 0; i -= 1) {
    sections.splice(removeIndexes[i], 1);
  }

  if (hasSkillsPayload && !skillsApplied) {
    sections.push({
      id: 'skills-from-formatter',
      section_title: 'Skills',
      kind: 'skills',
      content: {
        groups: buildSkillGroupsFromFormattedSkills(skillsFormatted!, mode),
      },
    });
  }

  if (hasExpPayload && !experienceApplied) {
    sections.push({
      id: 'experience-from-formatter',
      section_title: 'Experience',
      kind: 'experience',
      content: {
        items: expRows!.map((row) => ({ ...row })),
      },
    });
  }
}

/**
 * Build final sections for optimized_cv: prefer structured_cv.sections as skeleton; if empty, use rewriter output as shell only.
 * Always overlay authoritative skills/experience from formatters when present.
 */
export function buildOptimizedCvSectionsForStage15Merge(
  structuredSections: unknown[] | undefined,
  rewriterSections: unknown[] | undefined,
  skillFormatterResult: Record<string, unknown> | undefined,
  experienceFormatterResult: Record<string, unknown> | undefined
): unknown[] {
  const base =
    Array.isArray(structuredSections) && structuredSections.length > 0
      ? cloneSections(structuredSections)
      : Array.isArray(rewriterSections) && rewriterSections.length > 0
        ? cloneSections(rewriterSections)
        : [];

  applyAuthoritativeSkillsAndExperienceToSections(base, skillFormatterResult, experienceFormatterResult);
  return base;
}
