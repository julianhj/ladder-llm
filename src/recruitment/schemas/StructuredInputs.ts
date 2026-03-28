import { z } from 'zod';
import { cvListItemToDisplayString } from '../utils/cvListItemToDisplayString.js';

/**
 * SCHEMA MAP (StructuredInputs)
 *
 * - Structured CV = StructuredCVSchema / StructuredCV
 *   Single section-based shape: { header?, sections }. Used for both CV extractor output
 *   (CandidateProfile.structured_cv) and CV Optimizer output (optimized_cv in API and CVOptimizationResult).
 *
 * - Structured job description = StructuredJobDescriptionSchema / StructuredJobDescription
 *   JD extractor output; CandidateProfile.structured_job_description.
 */

// -----------------------------------------------------------------------------
// Preprocessing / pipeline schemas
// -----------------------------------------------------------------------------

/**
 * Additional section schema for non-standard CV/JD sections (used by StructuredJobDescription).
 */
export const AdditionalSectionSchema = z.object({
  section_name: z.string(),
  content: z.union([z.string(), z.array(z.string()), z.record(z.unknown())]),
});

/**
 * Structured Job Description Schema
 * JD extractor output; used as structured_job_description in the pipeline.
 */
export const StructuredJobDescriptionSchema = z.object({
  role_title: z.string(),
  company: z.string(),
  summary: z.string().optional(),
  evidence: z.array(z.object({
    supports: z.string(),
    quote: z.string(),
    source_section: z.string().optional(),
  })).optional(),
  required_skills: z.object({
    categories: z.array(z.object({
      category_name: z.string(),
      skills: z.array(z.string()),
    })),
  }).optional(),
  preferred_skills: z.object({
    categories: z.array(z.object({
      category_name: z.string(),
      skills: z.array(z.string()),
    })),
  }).optional(),
  responsibilities: z.array(z.string()).optional(),
  qualifications: z.object({
    education: z.array(z.string()).optional(),
    experience: z.string().optional(),
    certifications: z.array(z.string()).optional(),
  }).optional(),
  benefits: z.array(z.string()).optional(),
  compensation: z.string().optional(),
  additional_sections: z.array(AdditionalSectionSchema).optional(),
}).passthrough();

// -----------------------------------------------------------------------------
// Structured CV (header + sections) - used for extractor and optimizer output
// -----------------------------------------------------------------------------

export const CVRichTextParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  text: z.string(),
});

export const CVRichTextListBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.string()),
});

export const CVRichTextBlockSchema = z.union([CVRichTextParagraphBlockSchema, CVRichTextListBlockSchema]);

export const CVSectionKindSchema = z.enum([
  'summary',
  'skills',
  'experience',
  'education',
  'certifications',
  'awards',
  'list',
  'rich_text',
  'custom',
]);

const CVSectionBaseSchema = z.object({
  id: z.string().optional(),
  section_title: z.string().trim().min(1),
  kind: CVSectionKindSchema,
  meta: z
    .object({
      sourceSectionName: z.string().optional(),
      isOriginal: z.boolean().optional(),
      orderHint: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

export const CVSummarySectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('summary'),
  content: z.union([
    z.object({ text: z.string() }),
    z.object({ blocks: z.array(CVRichTextParagraphBlockSchema) }),
  ]),
});

export const CVSkillsGroupSchema = z.object({
  heading: z.string(),
  items: z.array(z.string()).optional(),
  narrative: z.string().optional(),
});

export const CVSkillsSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('skills'),
  content: z.union([
    z.object({
      categories: z.array(
        z.object({
          category_name: z.string(),
          skills: z.array(z.string()),
        })
      ),
    }),
    z.object({ blocks: z.array(CVRichTextParagraphBlockSchema) }),
    z.object({ groups: z.array(CVSkillsGroupSchema) }),
  ]),
});

export const CVExperienceSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('experience'),
  content: z.object({
    items: z.array(
      z
        .object({
          company: z.string().optional(),
          position: z.string().optional(),
          duration: z.string().optional(),
          description: z.string().optional(),
          responsibilities: z.array(z.string()).optional(),
          role: z.string().optional(),
          period: z.string().optional(),
          highlights: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
  }),
});

export const CVEducationSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('education'),
  content: z.object({
    items: z.array(
      z.object({
        degree: z.string().optional(),
        institution: z.string().optional(),
      })
    ),
  }),
});

/** Coerce each row to a display string (strings, numbers, or object rows from rewriters). */
const cvDisplayListItemsSchema = z
  .array(z.unknown())
  .transform((xs) => xs.map((x) => cvListItemToDisplayString(x)).filter((s) => s.length > 0));

export const CVListSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('list'),
  content: z.object({
    items: cvDisplayListItemsSchema,
  }),
});

/** Same shape as list; used when the CV names Certifications / Awards sections explicitly (rewriter and parsers). */
export const CVCertificationsSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('certifications'),
  content: z.object({
    items: cvDisplayListItemsSchema,
  }),
});

export const CVAwardsSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('awards'),
  content: z.object({
    items: cvDisplayListItemsSchema,
  }),
});

export const CVRichTextSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('rich_text'),
  content: z.object({
    blocks: z.array(CVRichTextBlockSchema),
  }),
});

export const CVCustomSectionSchema = CVSectionBaseSchema.extend({
  kind: z.literal('custom'),
  content: z.record(z.unknown()),
});

export const CVDisplaySectionSchema = z.discriminatedUnion('kind', [
  CVSummarySectionSchema,
  CVSkillsSectionSchema,
  CVExperienceSectionSchema,
  CVEducationSectionSchema,
  CVCertificationsSectionSchema,
  CVAwardsSectionSchema,
  CVListSectionSchema,
  CVRichTextSectionSchema,
  CVCustomSectionSchema,
]);

/**
 * Structured CV schema (single shape for both CV extractor and CV Optimizer output).
 * Header + sections; used as structured_cv and as optimized_cv.
 */
export const StructuredCVSchema = z
  .object({
    header: z
      .object({
        full_name: z.string().optional(),
        professional_title: z.string().optional(),
        contact: z
          .object({
            email: z.string().optional(),
            phone: z.string().optional(),
            linkedin: z.string().optional(),
            location: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    sections: z.array(CVDisplaySectionSchema),
  })
  .passthrough();

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type StructuredJobDescription = z.infer<typeof StructuredJobDescriptionSchema>;
export type AdditionalSection = z.infer<typeof AdditionalSectionSchema>;
export type StructuredCV = z.infer<typeof StructuredCVSchema>;
export type CVRichTextBlock = z.infer<typeof CVRichTextBlockSchema>;
export type CVSectionKind = z.infer<typeof CVSectionKindSchema>;
export type CVDisplaySection = z.infer<typeof CVDisplaySectionSchema>;
