import { z } from 'zod';
import {
  CVDisplaySectionSchema,
  CVRichTextSectionSchema,
  CVSummarySectionSchema,
  StructuredCVSchema,
} from '../../schemas/StructuredInputs.js';
import {
  DecisionEnumSchema,
  ExperienceFormatSchema,
  Score0To100Schema,
  SectionSchema,
  SkillRepresentationModeSchema,
  StringArraySchema,
} from './common.js';

export const CV_SECTION_HELP_KEYS = [
  'why_were_changes_made',
  'summary_of_edits',
  'role_fit',
  'missing_skills',
  'refined_cv',
  'keyword_ats',
  'ats_optimization',
] as const;

const OptimizedCVSchema = StructuredCVSchema;

/** Merge fallback when section rewriter rationale is missing: array of { heading, summary }. */
const RationaleFallbackSchema = z
  .array(
    z.object({
      heading: z
        .string()
        .describe(
          'Short label for this rationale block (e.g. "Evidence alignment", "Skills representation", "Experience tone").'
        ),
      summary: z
        .string()
        .optional()
        .describe('One to four sentences explaining that theme; reference concrete edits, not generic process text.'),
    })
  )
  .describe(
    'Compact rationale as ordered blocks. Use when not using the full Section shape. Each item covers one change theme.'
  );

const cvOptimizationRationaleDescription =
  'Why the CV was edited for this candidate and role. Tie changes to evidence_validated, enforced_claims, formatted skills, seniority or recruiter constraints, and target role. ' +
  'Must be substantive: no boilerplate such as a single sentence that only says optimization completed. ' +
  'Preferred: Section object with section_heading, section_description, and section_detail (section_detail_summary is substantive prose; summary_detail_bullets lists concrete reasons). ' +
  'Alternative: array of { heading, summary } objects, one major theme per element.';

/** Merged CV optimization can have rationale as Section (from agent) or array (merge fallback). */
const RationaleSchema = z
  .union([SectionSchema, RationaleFallbackSchema])
  .describe(cvOptimizationRationaleDescription);

const sectionRewriterRationaleDescription =
  'Why you rewrote the CV sections: connect edits to evidence_validated, enforced_claims, formatted_skills, formatted_experience, and rewrite_constraints. ' +
  'Use section_heading, section_description, and section_detail with a real section_detail_summary and summary_detail_bullets; avoid generic placeholders.';

/** role_fit_ats can return Section or empty array; merge may pass through. */
const KeywordEnhancementsSchema = z.union([
  SectionSchema,
  z.array(z.any()),
]);

export const CVOptimizationResultSchema = z.object({
  optimized_cv: OptimizedCVSchema,
  changes_made: StringArraySchema,
  rationale: RationaleSchema,
  ats_optimization: SectionSchema,
  keyword_enhancements: KeywordEnhancementsSchema,
  missing_skills: StringArraySchema,
  section_help: z.record(z.string(), z.any()).optional(),
  role_fit_summary: SectionSchema.optional(),
  previous_optimized_cv_hash: z.string().optional(),
});

export const EvidenceValidatedSchema = z.object({
  validated_scope_signals: StringArraySchema,
  validated_execution_signals: StringArraySchema,
  validated_leadership_signals: StringArraySchema,
  validated_business_signals: StringArraySchema,
  validated_risk_signals: StringArraySchema,
}).passthrough();

export const EnforcedClaimsSchema = z.object({
  enforced_scope_claims: StringArraySchema,
  enforced_leadership_claims: StringArraySchema,
  enforced_execution_claims: StringArraySchema,
}).passthrough();

/** Seniority-aware section title suggestions for the Section Rewriter (match `kind`, optional disambiguation). */
export const SectionTitleRecommendationSchema = z.object({
  section_kind: z.string(),
  recommended_section_title: z.string(),
  previous_section_title: z.string().optional(),
});

/** Minimum prose length per skills category when skill_representation_mode is narrative (full sentences, not keyword lines). */
export const MIN_NARRATIVE_SKILL_CATEGORY_CHARS = 40;

export const FormattedSkillsSchema = z
  .object({
    skills_formatted: z.record(z.string(), z.unknown()).default({}),
    missing_skills: StringArraySchema,
    skill_representation_mode: SkillRepresentationModeSchema,
    section_title_recommendations: z.array(SectionTitleRecommendationSchema).optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    for (const [key, raw] of Object.entries(data.skills_formatted)) {
      if (data.skill_representation_mode === 'keywords') {
        if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `skills_formatted["${key}"] must be a string[] when skill_representation_mode is keywords`,
            path: ['skills_formatted', key],
          });
        }
        continue;
      }

      if (typeof raw === 'string') {
        if (raw.trim().length < MIN_NARRATIVE_SKILL_CATEGORY_CHARS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `skills_formatted["${key}"] string narrative must be at least ${MIN_NARRATIVE_SKILL_CATEGORY_CHARS} characters`,
            path: ['skills_formatted', key],
          });
        }
        continue;
      }

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        const narrative = typeof o.narrative === 'string' ? o.narrative.trim() : '';
        if (narrative.length < MIN_NARRATIVE_SKILL_CATEGORY_CHARS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `skills_formatted["${key}"].narrative must be substantive prose (at least ${MIN_NARRATIVE_SKILL_CATEGORY_CHARS} characters)`,
            path: ['skills_formatted', key, 'narrative'],
          });
        }
        const items = o.items;
        if (Array.isArray(items) && items.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `skills_formatted["${key}"] must not include items in narrative mode; use narrative prose only`,
            path: ['skills_formatted', key, 'items'],
          });
        }
        continue;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `skills_formatted["${key}"] must be { narrative: string } or a long prose string when skill_representation_mode is narrative`,
        path: ['skills_formatted', key],
      });
    }
  });

/** Non-empty trimmed string for employer, title, and dates on every formatted experience row. */
const FormattedExperienceIdentityStringSchema = z
  .string()
  .min(1, { message: 'must be a non-empty string' })
  .describe('Required non-empty string (trimmed in post-processing before validation).');

/**
 * One formatted experience row from the Experience Representation Formatter.
 * company, position, and duration are required for downstream CV merge and UI; optional fields match hybrid/narrative/bullets modes.
 */
export const FormattedExperienceRowSchema = z
  .object({
    company: FormattedExperienceIdentityStringSchema.describe('Employer or organisation name from the source role.'),
    position: FormattedExperienceIdentityStringSchema.describe('Job title (use position even if source used role).'),
    duration: FormattedExperienceIdentityStringSchema.describe(
      'Date range as shown on the CV (use duration even if source used period).'
    ),
    narrative: z.string().optional().describe('Hybrid or narrative-mode role summary prose.'),
    highlights: z.array(z.string()).optional().describe('Hybrid or bullets-mode achievement lines.'),
    responsibilities: z.array(z.string()).optional().describe('Legacy bullets label; prefer highlights when applicable.'),
    role: z.string().optional().describe('Optional echo of title when also emitting position.'),
    period: z.string().optional().describe('Optional echo of dates when also emitting duration.'),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough()
  .describe('Single CV experience entry after formatting; identity fields are mandatory.');

export const FormattedExperienceSchema = z
  .object({
    experience_formatted: z.array(FormattedExperienceRowSchema).default([]),
    experience_format_used: ExperienceFormatSchema.optional().describe(
      'Echo of experience_format applied (bullets, hybrid, narrative).'
    ),
  })
  .passthrough();

/**
 * Section rewriter output. Models sometimes used `sections_rewritten` as a duplicate of `rewritten_sections`;
 * we coalesce to a single `rewritten_sections` array and drop the alias so API payloads are not confusing.
 */
export const RewrittenSectionsSchema = z
  .object({
    rewritten_sections: z.array(CVDisplaySectionSchema).optional(),
    sections_rewritten: z.array(CVDisplaySectionSchema).optional(),
    changes_made: StringArraySchema,
    rationale: SectionSchema.describe(sectionRewriterRationaleDescription),
  })
  .passthrough()
  .transform((data) => {
    const { sections_rewritten, rewritten_sections, ...rest } = data;
    const primary = Array.isArray(rewritten_sections) ? rewritten_sections : [];
    const alias = Array.isArray(sections_rewritten) ? sections_rewritten : [];
    const merged = primary.length > 0 ? primary : alias;
    return { ...rest, rewritten_sections: merged };
  });

/**
 * Sections the profile narrative rewriter may emit. Narrower than CVDisplaySectionSchema so the
 * Responses API JSON schema omits other kinds (e.g. certifications content uses a property named
 * `items`, which OpenAI structured outputs reject when listed in object `required`).
 */
const ProfileNarrativeSectionSchema = z.discriminatedUnion('kind', [
  CVSummarySectionSchema,
  CVRichTextSectionSchema,
]);

/**
 * Profile-only narrative rewrite output.
 * This is intentionally scoped to summary/rich_text sections so section rewriter can stay deterministic.
 */
export const ProfileNarrativeRewriteSchema = z
  .object({
    rewritten_profile_sections: z.array(ProfileNarrativeSectionSchema).default([]),
    changes_made: StringArraySchema,
    rationale: SectionSchema.describe(
      'Why profile summary text was rewritten; explain readability and positioning improvements grounded in evidence.'
    ),
    section_help: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const RoleFitSummarySchema = z.object({
  role_fit_summary: SectionSchema,
  ats_optimization: SectionSchema,
  keyword_enhancements: SectionSchema,
}).passthrough();

export const InterviewFeedbackSummarySchema = z.object({
  technical: SectionSchema,
  soft_skills: SectionSchema,
  leadership: SectionSchema,
  recruiter: SectionSchema,
  hiring_manager: SectionSchema,
});

export const CareerGuidanceResultSchema = z.object({
  career_advice: SectionSchema,
  interview_feedback_summary: SectionSchema,
});

export const FinalDecisionResultSchema = z.object({
  final_decision: DecisionEnumSchema,
  confidence: Score0To100Schema,
  reasoning: SectionSchema,
  next_steps: SectionSchema,
});

export type CVOptimizationResult = z.infer<typeof CVOptimizationResultSchema>;
export type ProfileNarrativeRewriteResult = z.infer<typeof ProfileNarrativeRewriteSchema>;
export type InterviewFeedbackSummary = z.infer<typeof InterviewFeedbackSummarySchema>;
export type CareerGuidanceResult = z.infer<typeof CareerGuidanceResultSchema>;
export type FinalDecisionResult = z.infer<typeof FinalDecisionResultSchema>;
