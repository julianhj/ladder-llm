import { mergeStage3Outputs } from '../src/recruitment/pipeline/stage_15_final_decision/mergeStage3.js';
import type { AgentResult } from '../src/recruitment/pipeline/PipelineRunner.js';
import { RewrittenSectionsSchema } from '../src/recruitment/agents/schemas/stage_15_final_decision.js';

const rewriterRationale = {
  section_heading: 'Rationale',
  section_description: 'Summary of edits applied to the CV sections.',
  section_detail: {
    section_detail_summary: 'x'.repeat(200),
    summary_detail_bullets: ['y'.repeat(100), 'z'.repeat(100)],
  },
};

interface MergeOutputsCombineConfig {
  type: 'combine';
  mode?: 'shallow';
  sourceAgents: string[];
  output: Record<string, unknown>;
}

describe('mergeStage3Outputs', () => {
  const mergeConfig: MergeOutputsCombineConfig = {
    type: 'combine',
    mode: 'shallow',
    sourceAgents: [
      'evidence_integration',
      'seniority_recruiter_reality_enforcement',
      'skill_representation_formatter',
      'experience_representation_formatter',
      'section_level_cv_rewriter',
      'role_fit_ats_enhancement',
    ],
    output: {
      optimized_cv_sections: { from: 'section_level_cv_rewriter', field: 'rewritten_sections' },
      missing_skills: { from: 'skill_representation_formatter', field: 'missing_skills' },
      skill_representation_mode_used: { from: 'skill_representation_formatter', field: 'skill_representation_mode' },
      changes_made: { from: 'section_level_cv_rewriter', field: 'changes_made' },
      rationale: { from: 'section_level_cv_rewriter', field: 'rationale' },
      ats_optimization: { from: 'role_fit_ats_enhancement', field: 'ats_optimization' },
      keyword_enhancements: { from: 'role_fit_ats_enhancement', field: 'keyword_enhancements' },
      role_fit_summary: { from: 'role_fit_ats_enhancement', field: 'role_fit_summary' },
      previous_optimized_cv_hash: { from: 'input', field: 'previous_optimized_cv_hash' },
    },
  };

  it('builds optimized_cv from Section Rewriter sections and adds merged fields', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Representation Formatter',
        result: {
          missing_skills: ['Python', 'AWS'],
          skill_representation_mode: 'keywords',
          skills_formatted: {},
        },
      },
      {
        success: true,
        agentId: 'experience_representation_formatter',
        agentName: 'Experience Representation Formatter',
        result: { experience_formatted: [] },
      },
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [
            { kind: 'summary', title: 'Summary', content: {} },
            { kind: 'experience', title: 'Experience', content: { items: [] } },
          ],
          changes_made: ['Updated summary', 'Refined experience'],
          rationale: [{ heading: 'Summary', summary: 'Aligned to role.' }],
        },
      },
      {
        success: true,
        agentId: 'role_fit_ats_enhancement',
        agentName: 'Role Fit & ATS Enhancement',
        result: {
          role_fit_summary: 'Strong fit for the role.',
          ats_optimization: 'Keywords added.',
          keyword_enhancements: ['Python', 'AWS'],
        },
      },
    ];
    const candidateProfile = {
      previous_optimized_cv_hash: 'abc123',
      structured_cv: {
        header: { full_name: 'Jane', professional_title: 'Engineer', contact: { email: 'j@example.com' } },
        sections: [
          { kind: 'summary', section_title: 'Summary', content: { text: '' } },
          { kind: 'experience', section_title: 'Experience', content: { items: [] } },
        ],
      },
    };

    const merged = mergeStage3Outputs(results, mergeConfig, candidateProfile as unknown as Parameters<typeof mergeStage3Outputs>[2]) as Record<string, unknown>;
    expect(merged.optimized_cv).toBeDefined();
    expect((merged.optimized_cv as Record<string, unknown>).header).toEqual(candidateProfile.structured_cv.header);
    expect((merged.optimized_cv as Record<string, unknown>).sections).toHaveLength(2);
    expect(merged.missing_skills).toEqual(['Python', 'AWS']);
    if (merged.skill_representation_mode_used !== undefined) {
      expect(merged.skill_representation_mode_used).toBe('keywords');
    }
    expect(merged.changes_made).toEqual(['Updated summary', 'Refined experience']);
    expect(merged.rationale).toHaveLength(1);
    expect(merged.ats_optimization).toBe('Keywords added.');
    expect(merged.keyword_enhancements).toEqual(['Python', 'AWS']);
    expect(merged.role_fit_summary).toBe('Strong fit for the role.');
    expect(merged.previous_optimized_cv_hash).toBe('abc123');
  });

  it('uses default rationale when Section Rewriter has no rationale', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [],
          changes_made: [],
        },
      },
    ];
    const merged = mergeStage3Outputs(results, mergeConfig, null) as Record<string, unknown>;
    expect(Array.isArray(merged.rationale)).toBe(true);
    expect((merged.rationale as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('accepts sections_rewritten as alias for rewritten_sections', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          sections_rewritten: [{ kind: 'summary', section_title: 'Summary', content: {} }],
          changes_made: [],
          rationale: [{ heading: 'R', summary: 'S' }],
        },
      },
    ];
    const merged = mergeStage3Outputs(results, mergeConfig, null) as Record<string, unknown>;
    expect((merged.optimized_cv as Record<string, unknown>).sections).toHaveLength(1);
  });

  it('overwrites rewriter skills and experience with formatter outputs when structured_cv provides sections', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Representation Formatter',
        result: {
          missing_skills: [],
          skill_representation_mode: 'keywords',
          skills_formatted: { Cloud: ['Lambda', 'S3'] },
        },
      },
      {
        success: true,
        agentId: 'experience_representation_formatter',
        agentName: 'Experience Representation Formatter',
        result: {
          experience_formatted: [
            {
              company: 'Acme',
              role: 'Engineer',
              period: '2020-2024',
              responsibilities: ['Shipped the product'],
            },
          ],
        },
      },
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [
            {
              kind: 'skills',
              section_title: 'Skills',
              content: { groups: [{ heading: 'Bad', items: ['rewriter-only'] }] },
            },
            {
              kind: 'experience',
              section_title: 'Experience',
              content: { items: [{ company: 'WrongCo', role: 'Intern' }] },
            },
          ],
          changes_made: [],
          rationale: rewriterRationale,
        },
      },
    ];
    const candidateProfile = {
      structured_cv: {
        header: { full_name: 'Pat', professional_title: 'Dev', contact: {} },
        sections: [
          { kind: 'skills', section_title: 'Skills', content: { groups: [{ heading: 'Old', items: ['x'] }] } },
          { kind: 'experience', section_title: 'Experience', content: { items: [{ company: 'OldCo' }] } },
        ],
      },
    };
    const merged = mergeStage3Outputs(
      results,
      mergeConfig,
      candidateProfile as unknown as Parameters<typeof mergeStage3Outputs>[2]
    ) as Record<string, unknown>;
    const sections = ((merged.optimized_cv as Record<string, unknown>).sections ?? []) as Array<Record<string, unknown>>;
    const skills = sections.find((s) => s.kind === 'skills');
    const exp = sections.find((s) => s.kind === 'experience');
    expect(skills).toBeDefined();
    const skillGroups = (skills!.content as Record<string, unknown>).groups as Array<Record<string, unknown>>;
    expect(skillGroups[0].heading).toBe('Cloud');
    expect(skillGroups[0].items).toEqual(['Lambda', 'S3']);
    const items = (exp!.content as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items[0].company).toBe('Acme');
    expect(items[0].responsibilities).toEqual(['Shipped the product']);
  });

  it('strips model-invented evidence-gap notes sections from optimized_cv', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [
            { kind: 'summary', section_title: 'Summary', content: { text: 'Summary text' } },
            {
              kind: 'custom',
              section_title: 'Additional Notes / Evidence Gaps',
              content: {
                items: [
                  'End-to-end ownership (needs evidence)',
                ],
              },
            },
          ],
          changes_made: [],
          rationale: [{ heading: 'R', summary: 'S' }],
        },
      },
    ];
    const merged = mergeStage3Outputs(results, mergeConfig, null) as Record<string, unknown>;
    const sections = ((merged.optimized_cv as Record<string, unknown>).sections ?? []) as Array<Record<string, unknown>>;
    const titles = sections.map((s) => String(s.section_title ?? s.title ?? '').toLowerCase());
    expect(titles.some((title) => title.includes('evidence gaps'))).toBe(false);
    expect(titles.some((title) => title.includes('additional notes'))).toBe(false);
  });

  it('keeps only one skills section when section rewriter returns duplicated skills shells', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Representation Formatter',
        result: {
          missing_skills: [],
          skill_representation_mode: 'keywords',
          skills_formatted: { Platform: ['Kubernetes', 'Terraform'] },
        },
      },
      {
        success: true,
        agentId: 'experience_representation_formatter',
        agentName: 'Experience Representation Formatter',
        result: {
          experience_formatted: [],
        },
      },
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [
            {
              kind: 'skills',
              section_title: 'Skills',
              content: { groups: [{ heading: 'Bad A', items: ['A'] }] },
            },
            {
              kind: 'skills',
              section_title: 'Core Skills',
              content: { groups: [{ heading: 'Bad B', items: ['B'] }] },
            },
          ],
          changes_made: [],
          rationale: rewriterRationale,
        },
      },
    ];

    const merged = mergeStage3Outputs(results, mergeConfig, { structured_cv: { sections: [] } } as any) as Record<string, unknown>;
    const sections = ((merged.optimized_cv as Record<string, unknown>).sections ?? []) as Array<Record<string, unknown>>;
    const skillsSections = sections.filter((s) => s.kind === 'skills');

    expect(skillsSections).toHaveLength(1);
    const groups = (skillsSections[0].content as Record<string, unknown>).groups as Array<Record<string, unknown>>;
    expect(groups[0].heading).toBe('Platform');
    expect(groups[0].items).toEqual(['Kubernetes', 'Terraform']);
  });

  it('preserves keyword_enhancements when Role Fit returns a Section object (not only string arrays)', () => {
    const longSummary = 'x'.repeat(200);
    const longBullet = 'y'.repeat(100);
    const sectionKeywords = {
      section_heading: 'Keyword alignment',
      section_description: 'Terms to mirror the job description.',
      section_detail: {
        section_detail_summary: longSummary,
        summary_detail_bullets: [longBullet, longBullet],
      },
    };
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [],
          changes_made: [],
          rationale: [{ heading: 'R', summary: 'S' }],
        },
      },
      {
        success: true,
        agentId: 'role_fit_ats_enhancement',
        agentName: 'Role Fit & ATS Enhancement',
        result: {
          role_fit_summary: sectionKeywords,
          ats_optimization: sectionKeywords,
          keyword_enhancements: sectionKeywords,
        },
      },
    ];
    const merged = mergeStage3Outputs(results, mergeConfig, null) as Record<string, unknown>;
    expect(merged.keyword_enhancements).toEqual(sectionKeywords);
  });

  it('keeps skills group headings from skills_formatted keys even when section title recommendations exist', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Representation Formatter',
        result: {
          missing_skills: [],
          skill_representation_mode: 'keywords',
          skills_formatted: {
            Architecture: ['Domain-driven design'],
            Leadership: ['Mentoring'],
          },
          section_title_recommendations: [
            {
              section_kind: 'skills',
              previous_section_title: 'Architecture',
              recommended_section_title: 'Architecture Leadership & Strategy',
            },
          ],
        },
      },
      {
        success: true,
        agentId: 'experience_representation_formatter',
        agentName: 'Experience Representation Formatter',
        result: { experience_formatted: [] },
      },
      {
        success: true,
        agentId: 'section_level_cv_rewriter',
        agentName: 'Section-Level CV Rewriter',
        result: {
          rewritten_sections: [
            {
              kind: 'skills',
              section_title: 'Skills',
              content: { groups: [] },
            },
          ],
          changes_made: [],
          rationale: rewriterRationale,
        },
      },
    ];

    const merged = mergeStage3Outputs(results, mergeConfig, { structured_cv: { sections: [] } } as any) as Record<string, unknown>;
    const sections = ((merged.optimized_cv as Record<string, unknown>).sections ?? []) as Array<Record<string, unknown>>;
    const skills = sections.find((s) => s.kind === 'skills');
    expect(skills).toBeDefined();
    const groups = ((skills?.content as Record<string, unknown>)?.groups ?? []) as Array<Record<string, unknown>>;
    expect(groups.map((g) => g.heading)).toEqual(['Architecture', 'Leadership']);
  });

  it('still builds optimized_cv when section rewriter output is missing', () => {
    const results: AgentResult[] = [
      {
        success: true,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Representation Formatter',
        result: {
          missing_skills: ['Kubernetes'],
          skill_representation_mode: 'keywords',
          skills_formatted: { Platform: ['Kubernetes', 'Terraform'] },
        },
      },
      {
        success: true,
        agentId: 'experience_representation_formatter',
        agentName: 'Experience Representation Formatter',
        result: {
          experience_formatted: [
            {
              company: 'Acme',
              position: 'Lead Engineer',
              duration: '2021-2024',
              highlights: ['Led platform modernization'],
            },
          ],
        },
      },
      {
        success: true,
        agentId: 'role_fit_ats_enhancement',
        agentName: 'Role Fit & ATS Enhancement',
        result: {
          ats_optimization: '',
          keyword_enhancements: [],
        },
      },
    ];

    const candidateProfile = {
      structured_cv: {
        header: { full_name: 'Pat', professional_title: 'Engineer', contact: {} },
        sections: [
          { kind: 'summary', section_title: 'Summary', content: { text: 'Summary text' } },
          { kind: 'skills', section_title: 'Skills', content: { groups: [] } },
          { kind: 'experience', section_title: 'Experience', content: { items: [] } },
        ],
      },
    };

    const merged = mergeStage3Outputs(
      results,
      mergeConfig,
      candidateProfile as unknown as Parameters<typeof mergeStage3Outputs>[2]
    ) as Record<string, unknown>;

    const optimized = merged.optimized_cv as Record<string, unknown> | undefined;
    expect(optimized).toBeDefined();
    const sections = (optimized?.sections ?? []) as Array<Record<string, unknown>>;
    const skills = sections.find((s) => s.kind === 'skills');
    const exp = sections.find((s) => s.kind === 'experience');
    expect(skills).toBeDefined();
    expect(exp).toBeDefined();
    const groups = ((skills?.content as Record<string, unknown>)?.groups ?? []) as Array<Record<string, unknown>>;
    expect(groups[0].heading).toBe('Platform');
    const items = ((exp?.content as Record<string, unknown>)?.items ?? []) as Array<Record<string, unknown>>;
    expect(items[0].company).toBe('Acme');
  });
});

describe('RewrittenSectionsSchema', () => {
  it('keeps a single rewritten_sections array and drops sections_rewritten when both are present', () => {
    const canonical = { section_title: 'Professional Summary', kind: 'summary', content: { text: 'Summary text' } };
    const duplicate = { section_title: 'Skills', kind: 'skills', content: { groups: [{ heading: 'Core', items: ['AWS'] }] } };
    const out = RewrittenSectionsSchema.parse({
      rewritten_sections: [canonical],
      sections_rewritten: [duplicate],
      changes_made: [],
      rationale: rewriterRationale,
    });
    expect(out.rewritten_sections).toEqual([canonical]);
    expect('sections_rewritten' in out).toBe(false);
  });

  it('accepts legacy sections_rewritten only and normalizes to rewritten_sections', () => {
    const aliasOnly = { section_title: 'Professional Summary', kind: 'summary', content: { text: 'Summary text' } };
    const out = RewrittenSectionsSchema.parse({
      sections_rewritten: [aliasOnly],
      changes_made: [],
      rationale: rewriterRationale,
    });
    expect(out.rewritten_sections).toEqual([aliasOnly]);
    expect('sections_rewritten' in out).toBe(false);
  });
});
