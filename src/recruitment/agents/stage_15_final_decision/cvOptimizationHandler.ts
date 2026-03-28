import type { AgentConfig } from '../agentConfig.js';
import type { CandidateProfile } from '../schemas/index.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import {
  reconcileOptimizedExperienceEntries,
  normalizeOptimizedCvForValidation,
  normalizeCvOptimizationResultForOutput,
  injectMissingListSectionsFromSource,
} from './normalizer.js';
import {
  collectSkillsFromOptimizedCv,
  enforceSkillsSectionFormat,
  filterMissingSkillsBySeniorityContext,
  normalizeMissingSkills,
  parseSeniorityEnforcementSlice,
  validateSkillFormat,
} from '../../utils/skillRepresentation.js';
import { mergeSelectedMissingSkillsIntoStructuredCv } from '../../utils/mergeSelectedMissingSkillsIntoStructuredCv.js';
import { stripSkillHeadingMetadata } from '../../utils/stripSkillHeadingMetadata.js';
import { mergeDuplicateSkillGroupsByHeading } from '../../utils/normalizeFormattedSkillsOutput.js';
import type { StructuredCV } from '../../schemas/StructuredInputs.js';
import { Logger } from '../../utils/Logger.js';
import type { AgentTypeHandler, PostProcessContext } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';

export const cvOptimizationHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName, agentId?: string): boolean {
    return outputSchema === 'cv_optimization' || agentId === 'cv_optimizer';
  },

  buildPromptObject(
    _fragments: CommonPromptFragments,
    promptObject: Record<string, unknown>,
    _config: AgentConfig
  ): Record<string, unknown> {
    return promptObject;
  },

  buildPrompt(_fragments: CommonPromptFragments, basePrompt: string, _config: AgentConfig): string {
    return basePrompt;
  },

  getSystemMessage(): string {
    return '';
  },

  enrichInputData(
    inputData: Record<string, string>,
    candidateProfile: CandidateProfile,
    _config: AgentConfig
  ): void {
    inputData['target_role_title'] = candidateProfile.role_applying_for ?? '';
    if (inputData['target_role_seniority'] == null || inputData['target_role_seniority'] === '') {
      inputData['target_role_seniority'] = candidateProfile.role_applying_for ?? '';
    }
    if (inputData['experience_format'] == null || inputData['experience_format'] === '') {
      inputData['experience_format'] = 'bullets';
    }
    const orgScope = candidateProfile.org_scope_metadata;
    if (orgScope && typeof orgScope === 'object' && Object.keys(orgScope).length > 0) {
      inputData['org_scope_metadata'] = JSON.stringify(orgScope);
    }
  },

  postProcessBeforeValidation(parsed: unknown, context: PostProcessContext): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const parsedObj = parsed as Record<string, unknown>;
    const { inputData, candidateProfile, agentName, stageName, agentId } = context;
    /** Stage 15 combine merge: skills/experience are authoritative from formatters; avoid rewrites here. */
    const isStage15MergedCv = agentId === 'merged';

    const skillMode = (inputData['skill_representation_mode'] === 'narrative' ? 'narrative' : 'keywords') as 'keywords' | 'narrative';
    const enforcementForFilter = {
      ...parseSeniorityEnforcementSlice(
        typeof inputData.seniority_signal_enforcement === 'string' ? inputData.seniority_signal_enforcement : undefined
      ),
      ...(typeof inputData.target_seniority_class === 'string' && inputData.target_seniority_class.trim() !== ''
        ? { target_seniority_class: inputData.target_seniority_class.trim() }
        : {}),
      ...(typeof inputData.candidate_seniority_class === 'string' && inputData.candidate_seniority_class.trim() !== ''
        ? { candidate_seniority_class: inputData.candidate_seniority_class.trim() }
        : {}),
    };
    const targetSeniorityForMerge =
      (typeof inputData.target_seniority_class === 'string' && inputData.target_seniority_class.trim() !== ''
        ? inputData.target_seniority_class.trim()
        : enforcementForFilter.target_seniority_class) ?? 'unknown';

    let selectedMissingSkills: string[] = [];
    const rawSelectedMissingSkills = inputData.selected_missing_skills;
    if (rawSelectedMissingSkills) {
      try {
        const parsedSelected = JSON.parse(rawSelectedMissingSkills);
        if (Array.isArray(parsedSelected)) {
          const raw = parsedSelected
            .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
            .filter((item: string) => item.length > 0);
          selectedMissingSkills = normalizeMissingSkills(raw, skillMode);
        }
      } catch {
        // Ignore malformed selected_missing_skills
      }
    }

    const optimizedCv = parsedObj.optimized_cv;
    if (!optimizedCv || typeof optimizedCv !== 'object' || Array.isArray(optimizedCv)) {
      if (!('optimized_cv' in parsedObj)) {
        const responseKeys = Object.keys(parsedObj);
        const error = new Error(`CRITICAL: optimized_cv is missing from CV Optimizer response before Zod validation. Response contains: [${responseKeys.join(', ')}]`);
        Logger.error('AgentBuilder', error.message, undefined, {
          agentName,
          stageName,
          responseKeys,
          responsePreview: JSON.stringify(parsedObj).substring(0, 1000),
        });
        throw error;
      }
      return parsed;
    }

    const optimizedCvRecord = optimizedCv as Record<string, unknown>;
    normalizeOptimizedCvForValidation(optimizedCvRecord);

    const sourceStructuredCv = candidateProfile?.structured_cv as
      | { education?: unknown[]; certifications?: unknown[]; awards?: unknown[] }
      | undefined;
    const listInjection = injectMissingListSectionsFromSource(optimizedCvRecord, sourceStructuredCv);
    if (listInjection.injected.length > 0) {
      Logger.debug('AgentBuilder', 'Injected missing list sections from source CV', {
        agentName,
        stageName,
        injected: listInjection.injected,
      });
      if (!Array.isArray(parsedObj.changes_made)) {
        parsedObj.changes_made = [];
      }
      (parsedObj.changes_made as string[]).push(
        `Restored ${listInjection.injected.join(', ')} from source CV`
      );
    }

    if (!isStage15MergedCv) {
      const sourceExperience = candidateProfile?.structured_cv?.experience;
      const experienceRepair = reconcileOptimizedExperienceEntries(
        optimizedCvRecord,
        sourceExperience
      );

      Logger.debug('AgentBuilder', 'CV experience preservation check completed', {
        agentName,
        stageName,
        sourceExperienceCount: experienceRepair.sourceExperienceCount,
        optimizedExperienceCountBeforeRepair: experienceRepair.optimizedExperienceCountBeforeRepair,
        optimizedExperienceCountAfterRepair: experienceRepair.optimizedExperienceCountAfterRepair,
        recoveredExperienceEntriesCount: experienceRepair.recoveredEntries.length,
        recoveredExperienceEntries: experienceRepair.recoveredEntries,
      });

      if (experienceRepair.recoveredEntries.length > 0) {
        const recoverySummary = experienceRepair.recoveredEntries
          .map((entry) => `${entry.company} - ${entry.role}`)
          .join('; ');
        if (!Array.isArray(parsedObj.changes_made)) {
          parsedObj.changes_made = [];
        }
        (parsedObj.changes_made as string[]).push(
          `Restored ${experienceRepair.recoveredEntries.length} missing experience entr${experienceRepair.recoveredEntries.length === 1 ? 'y' : 'ies'} from source CV: ${recoverySummary}`
        );
      }
    }

    const normalizeSkillGroups = (groups: Array<{ heading?: string; items?: string[]; narrative?: string }>) => {
      for (const group of groups) {
        if (typeof group.heading === 'string' && group.heading.trim().length > 0) {
          group.heading = stripSkillHeadingMetadata(group.heading);
        }
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
    };

    const ensureSkillsSectionAndNormalize = () => {
      const sections = optimizedCvRecord.sections as unknown[] | undefined;
      if (!Array.isArray(sections)) return;
      let skillsSectionIndex = sections.findIndex(
        (section: unknown) => section && typeof section === 'object' && !Array.isArray(section) && (section as Record<string, unknown>).kind === 'skills'
      );
      let skillsSection: Record<string, unknown> | undefined =
        skillsSectionIndex >= 0 ? (sections[skillsSectionIndex] as Record<string, unknown>) : undefined;
      if (!skillsSection) {
        skillsSection = {
          id: `section-${sections.length + 1}`,
          title: 'Skills',
          kind: 'skills',
          content: { groups: [{ heading: 'Skills', items: [] }] },
        };
        skillsSectionIndex = sections.length;
        sections.push(skillsSection);
      }
      const content = skillsSection.content as Record<string, unknown> | undefined;
      if (!content || typeof content !== 'object' || Array.isArray(content)) {
        skillsSection.content = { groups: [{ heading: 'Skills', items: [] }] };
        return;
      }
      let groups = content.groups as Array<{ heading?: string; items?: string[]; narrative?: string }> | undefined;
      if (!Array.isArray(groups) || groups.length === 0) {
        const categories = content.categories as Array<{ category_name?: string; name?: string; skills?: unknown[] }> | undefined;
        if (Array.isArray(categories) && categories.length > 0) {
          groups = categories.map((c) => ({
            heading:
              typeof (c?.category_name ?? c?.name) === 'string'
                ? stripSkillHeadingMetadata(String(c?.category_name ?? c?.name))
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
      normalizeSkillGroups(groups);
      mergeDuplicateSkillGroupsByHeading(groups);
    };

    const normalizeSectionBullets = (section: Record<string, unknown>) => {
      const kind = String(section?.kind ?? '').trim();
      const content = section?.content;
      if (!content || typeof content !== 'object' || Array.isArray(content)) return;

      if (kind === 'experience' && Array.isArray((content as Record<string, unknown>).items)) {
        const items = (content as Record<string, unknown>).items as Record<string, unknown>[];
        for (const entry of items) {
          if (!entry || typeof entry !== 'object') continue;
          const responsibilities = entry.responsibilities;
          if (!Array.isArray(responsibilities)) continue;
          const cleaned = responsibilities
            .map((r: unknown) => String(r ?? '').trim())
            .filter((r: string) => r.length > 0);
          const seen = new Set<string>();
          entry.responsibilities = cleaned.filter((r: string) => {
            const key = r.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        return;
      }

      if (kind === 'list' && Array.isArray((content as Record<string, unknown>).items)) {
        const items = (content as Record<string, unknown>).items as string[];
        const cleaned = items
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0);
        const seen = new Set<string>();
        (content as Record<string, unknown>).items = cleaned.filter((item) => {
          const key = item.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return;
      }

      if (kind === 'rich_text' && Array.isArray((content as Record<string, unknown>).blocks)) {
        const blocks = (content as Record<string, unknown>).blocks as Record<string, unknown>[];
        for (const block of blocks) {
          if (!block || typeof block !== 'object' || block.type !== 'list') continue;
          const blockItems = block.items;
          if (!Array.isArray(blockItems)) continue;
          const cleaned = blockItems
            .map((item: unknown) => String(item ?? '').trim())
            .filter((item: string) => item.length > 0);
          const seen = new Set<string>();
          block.items = cleaned.filter((item: string) => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
      }
    };

    if (!isStage15MergedCv) {
      ensureSkillsSectionAndNormalize();

      const sections = optimizedCvRecord.sections as unknown[] | undefined;
      if (Array.isArray(sections)) {
        for (const section of sections) {
          if (section && typeof section === 'object' && !Array.isArray(section)) {
            normalizeSectionBullets(section as Record<string, unknown>);
          }
        }
      }

      enforceSkillsSectionFormat(optimizedCvRecord, skillMode);
      const collectedSkills = collectSkillsFromOptimizedCv(optimizedCvRecord);
      validateSkillFormat(collectedSkills, skillMode);
    }

    if (selectedMissingSkills.length > 0) {
      const addedSkills = mergeSelectedMissingSkillsIntoStructuredCv(
        optimizedCvRecord as unknown as StructuredCV,
        selectedMissingSkills,
        { skillMode, targetSeniorityClass: targetSeniorityForMerge }
      );
      if (addedSkills.length > 0 && Array.isArray(parsedObj.changes_made)) {
        (parsedObj.changes_made as string[]).push(
          `Added user-selected missing skills to optimized CV: ${addedSkills.join(', ')}`
        );
      }
    }

    // Remove user-selected skills from missing_skills so they are not shown as still missing after being added to the CV
    let missingList = (parsedObj.missing_skills as string[] | undefined) ?? [];
    if (selectedMissingSkills.length > 0) {
      const selectedSet = new Set(
        selectedMissingSkills.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)
      );
      missingList = missingList.filter((item) => {
        const normalized = String(item ?? '').trim().toLowerCase();
        if (!normalized) return false;
        if (selectedSet.has(normalized)) return false;
        const firstPart = normalized.split(',')[0]?.trim() ?? '';
        return !selectedSet.has(firstPart);
      });
    }
    missingList = filterMissingSkillsBySeniorityContext(missingList, enforcementForFilter);
    parsedObj.missing_skills = normalizeMissingSkills(missingList, skillMode);
    const inputMode = String(inputData['skill_representation_mode'] ?? 'keywords');
    const modeUsed = parsedObj.skill_representation_mode_used;
    if (modeUsed && modeUsed !== inputMode) {
      Logger.warn('AgentBuilder', 'CV Optimizer skill_representation_mode_used differs from input', {
        agentName,
        stageName,
        inputMode,
        outputMode: modeUsed,
      });
    }

    return parsed;
  },

  postProcessAfterValidation(validated: unknown, _config: AgentConfig): unknown {
    return normalizeCvOptimizationResultForOutput(validated);
  },
};
