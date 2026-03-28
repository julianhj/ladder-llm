import { cvOptimizationHandler } from '../src/recruitment/agents/stage_15_final_decision/cvOptimizationHandler.js';
import type { CandidateProfile } from '../src/recruitment/agents/schemas/index.js';

describe('cvOptimizationHandler.enrichInputData', () => {
  const baseProfile = {
    name: 'Test',
    email: 'test@example.com',
    company_name: 'Acme',
    role_applying_for: 'Senior Software Engineer',
    structured_cv: { sections: [] },
    structured_job_description: '',
  } as unknown as CandidateProfile;

  it('does not overwrite target_role_seniority or experience_format when already set by pipeline', () => {
    const inputData: Record<string, string> = {
      target_role_seniority: 'Director-level scope',
      experience_format: 'hybrid',
    };
    cvOptimizationHandler.enrichInputData!(inputData, { ...baseProfile, role_applying_for: 'Sr Manager' }, {} as any);
    expect(inputData['target_role_seniority']).toBe('Director-level scope');
    expect(inputData['experience_format']).toBe('hybrid');
    expect(inputData['target_role_title']).toBe('Sr Manager');
  });

  it('sets target_role_seniority and experience_format to passthrough and bullets when not set', () => {
    const inputData: Record<string, string> = {};
    cvOptimizationHandler.enrichInputData!(inputData, baseProfile, {} as any);
    expect(inputData['target_role_title']).toBe('Senior Software Engineer');
    expect(inputData['target_role_seniority']).toBe('Senior Software Engineer');
    expect(inputData['experience_format']).toBe('bullets');
  });
});

describe('cvOptimizationHandler.postProcessBeforeValidation missing skills mode behavior', () => {
  const candidateProfile = {
    name: 'Test',
    email: 'test@example.com',
    company_name: 'Acme',
    role_applying_for: 'Senior Software Engineer',
    structured_cv: { sections: [] },
    structured_job_description: '',
  } as unknown as CandidateProfile;

  const buildParsed = () => ({
    optimized_cv: {
      sections: [
        {
          section_title: 'Skills',
          kind: 'skills',
          content: {
            groups: [
              {
                heading: 'Additional Skills',
                items: ['TypeScript'],
              },
            ],
          },
        },
      ],
    },
    changes_made: [],
    rationale: [{ heading: 'Summary', summary: 'ok' }],
    ats_optimization: '',
    keyword_enhancements: [],
    missing_skills: ['Kubernetes', 'Terraform'],
  });

  it('adds selected missing skills as keyword items in keywords mode', () => {
    const parsed = buildParsed();
    const out = cvOptimizationHandler.postProcessBeforeValidation!(parsed, {
      inputData: {
        skill_representation_mode: 'keywords',
        selected_missing_skills: JSON.stringify(['Kubernetes', 'Terraform']),
      },
      candidateProfile,
      config: {} as any,
      agentId: 'cv_optimizer',
      agentName: 'CV Optimizer',
      stageName: 'Stage 15',
    }) as any;

    const groups = out.optimized_cv.sections[0].content.groups;
    const allItems = groups.flatMap((g: any) => (Array.isArray(g.items) ? g.items : []));
    expect(allItems).toContain('Kubernetes');
    expect(allItems).toContain('Terraform');
  });

  it('rewrites selected missing skills to narrative text in narrative mode', () => {
    const parsed = buildParsed();
    const out = cvOptimizationHandler.postProcessBeforeValidation!(parsed, {
      inputData: {
        skill_representation_mode: 'narrative',
        selected_missing_skills: JSON.stringify(['Kubernetes', 'Terraform']),
      },
      candidateProfile,
      config: {} as any,
      agentId: 'cv_optimizer',
      agentName: 'CV Optimizer',
      stageName: 'Stage 15',
    }) as any;

    const groups = out.optimized_cv.sections[0].content.groups;
    const allItems = groups.flatMap((g: any) => (Array.isArray(g.items) ? g.items : []));
    const allNarrative = groups.map((g: any) => String(g.narrative ?? '')).join(' ');
    expect(allItems).not.toContain('Kubernetes');
    expect(allItems).not.toContain('Terraform');
    expect(allNarrative.toLowerCase()).toContain('kubernetes');
    expect(allNarrative.toLowerCase()).toContain('terraform');
    expect(allNarrative).toMatch(/Kubernetes\./);
    expect(allNarrative.toLowerCase()).not.toContain('demonstrates capability');
    expect(allNarrative.toLowerCase()).not.toContain('should be checked');
    expect(allNarrative.toLowerCase()).not.toContain('should be validated');
  });

  it('is idempotent for narrative insertion and removes selected skills from missing_skills', () => {
    const parsed = buildParsed();
    const context = {
      inputData: {
        skill_representation_mode: 'narrative',
        selected_missing_skills: JSON.stringify(['Kubernetes']),
      },
      candidateProfile,
      config: {} as any,
      agentId: 'cv_optimizer',
      agentName: 'CV Optimizer',
      stageName: 'Stage 15',
    };
    const first = cvOptimizationHandler.postProcessBeforeValidation!(parsed, context) as any;
    const second = cvOptimizationHandler.postProcessBeforeValidation!(first, context) as any;
    const groups = second.optimized_cv.sections[0].content.groups;
    const allNarrative = groups.map((g: any) => String(g.narrative ?? '')).join(' ');
    const occurrences = (allNarrative.match(/Kubernetes\./g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(Array.isArray(second.missing_skills)).toBe(true);
    expect(second.missing_skills.map((s: string) => s.toLowerCase())).not.toContain('kubernetes');
  });

  it('merges duplicate skill group headings after metadata strip', () => {
    const parsed = {
      optimized_cv: {
        sections: [
          {
            section_title: 'Skills',
            kind: 'skills',
            content: {
              groups: [
                { heading: 'Tools', items: ['Git'] },
                { heading: 'Tools (evidenced)', items: ['Docker'] },
              ],
            },
          },
        ],
      },
      changes_made: [],
      rationale: [{ heading: 'Summary', summary: 'ok' }],
      ats_optimization: '',
      keyword_enhancements: [],
      missing_skills: [],
    };
    const out = cvOptimizationHandler.postProcessBeforeValidation!(parsed, {
      inputData: { skill_representation_mode: 'keywords' },
      candidateProfile,
      config: {} as any,
      agentId: 'cv_optimizer',
      agentName: 'CV Optimizer',
      stageName: 'Stage 15',
    }) as any;

    const groups = out.optimized_cv.sections[0].content.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe('Tools');
    expect(groups[0].items).toEqual(expect.arrayContaining(['Git', 'Docker']));
  });

  it('does not create standalone notes or evidence-gap sections', () => {
    const parsed = buildParsed();
    const out = cvOptimizationHandler.postProcessBeforeValidation!(parsed, {
      inputData: {
        skill_representation_mode: 'keywords',
        selected_missing_skills: JSON.stringify(['DORA metrics']),
      },
      candidateProfile,
      config: {} as any,
      agentId: 'cv_optimizer',
      agentName: 'CV Optimizer',
      stageName: 'Stage 15',
    }) as any;

    const sections = Array.isArray(out.optimized_cv?.sections) ? out.optimized_cv.sections : [];
    const titles = sections.map((s: any) => String(s?.section_title ?? s?.title ?? '').toLowerCase());
    expect(titles.some((title: string) => title.includes('additional notes'))).toBe(false);
    expect(titles.some((title: string) => title.includes('evidence gaps'))).toBe(false);
  });
});
