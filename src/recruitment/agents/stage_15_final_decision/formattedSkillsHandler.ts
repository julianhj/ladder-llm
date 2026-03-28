import type { AgentConfig } from '../agentConfig.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler, PostProcessContext } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';
import {
  dedupeSectionTitleRecommendations,
  normalizeSkillsFormattedRecord,
  type SectionTitleRecommendationInput,
} from '../../utils/normalizeFormattedSkillsOutput.js';

/**
 * Post-process Skill Formatter output: collapse duplicate skill category keys and dedupe section title recommendations.
 */
export const formattedSkillsHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName): boolean {
    return outputSchema === 'formatted_skills';
  },

  buildPromptObject(
    _fragments: CommonPromptFragments,
    promptObject: Record<string, unknown>,
    _config: AgentConfig
  ): Record<string, unknown> {
    return promptObject;
  },

  getSystemMessage(): string {
    return '';
  },

  postProcessBeforeValidation(parsed: unknown, _context: PostProcessContext): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const o = parsed as Record<string, unknown>;

    if (o.skills_formatted != null && typeof o.skills_formatted === 'object' && !Array.isArray(o.skills_formatted)) {
      o.skills_formatted = normalizeSkillsFormattedRecord(o.skills_formatted as Record<string, unknown>);
    }

    if (Array.isArray(o.section_title_recommendations)) {
      o.section_title_recommendations = dedupeSectionTitleRecommendations(
        o.section_title_recommendations as SectionTitleRecommendationInput[]
      );
    }

    return o;
  },
};
