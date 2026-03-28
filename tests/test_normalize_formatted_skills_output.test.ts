import {
  FormattedSkillsSchema,
  MIN_NARRATIVE_SKILL_CATEGORY_CHARS,
} from '../src/recruitment/agents/schemas/stage_15_final_decision.js';
import { formattedSkillsHandler } from '../src/recruitment/agents/stage_15_final_decision/formattedSkillsHandler.js';
import {
  dedupeSectionTitleRecommendations,
  mergeDuplicateSkillGroupsByHeading,
  normalizeSkillsFormattedRecord,
} from '../src/recruitment/utils/normalizeFormattedSkillsOutput.js';

describe('normalizeSkillsFormattedRecord', () => {
  it('merges record keys that normalize to the same heading', () => {
    const out = normalizeSkillsFormattedRecord({
      'Cloud (evidenced)': ['AWS'],
      Cloud: ['GCP'],
    });
    expect(Object.keys(out)).toEqual(['Cloud']);
    expect(out.Cloud).toEqual(['AWS', 'GCP']);
  });
});

describe('dedupeSectionTitleRecommendations', () => {
  it('dedupes by section_kind and previous_section_title; last wins', () => {
    const out = dedupeSectionTitleRecommendations([
      { section_kind: 'summary', recommended_section_title: 'A', previous_section_title: 'Summary' },
      { section_kind: 'summary', recommended_section_title: 'B', previous_section_title: 'Summary' },
      { section_kind: 'skills', recommended_section_title: 'Technical capabilities' },
    ]);
    expect(out).toEqual([
      { section_kind: 'summary', recommended_section_title: 'B', previous_section_title: 'Summary' },
      { section_kind: 'skills', recommended_section_title: 'Technical capabilities' },
    ]);
  });
});

describe('mergeDuplicateSkillGroupsByHeading', () => {
  it('merges groups with same normalized heading', () => {
    const groups = [
      { heading: 'Tools', items: ['a'] },
      { heading: 'Tools (evidenced)', items: ['b'] },
    ];
    mergeDuplicateSkillGroupsByHeading(groups);
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe('Tools');
    expect(groups[0].items).toEqual(['a', 'b']);
  });

});

describe('FormattedSkillsSchema + formattedSkillsHandler', () => {
  it('accepts optional section_title_recommendations', () => {
    const parsed = FormattedSkillsSchema.parse({
      skills_formatted: { Leadership: ['Mentoring'] },
      missing_skills: [],
      skill_representation_mode: 'keywords',
      section_title_recommendations: [
        { section_kind: 'summary', recommended_section_title: 'Professional profile', previous_section_title: 'Summary' },
      ],
    });
    expect(parsed.section_title_recommendations).toHaveLength(1);
  });

  it('accepts narrative mode with { narrative } per category', () => {
    const prose = 'A'.repeat(MIN_NARRATIVE_SKILL_CATEGORY_CHARS);
    const parsed = FormattedSkillsSchema.parse({
      skills_formatted: {
        Leadership: { narrative: prose },
        Platforms: { narrative: `${prose} extra words for second category.` },
      },
      missing_skills: [],
      skill_representation_mode: 'narrative',
    });
    expect((parsed.skills_formatted as Record<string, { narrative: string }>).Leadership.narrative).toBe(prose);
  });

  it('rejects narrative mode when category value is a keyword array', () => {
    expect(() =>
      FormattedSkillsSchema.parse({
        skills_formatted: { Leadership: ['a', 'b'] },
        missing_skills: [],
        skill_representation_mode: 'narrative',
      })
    ).toThrow();
  });

  it('rejects narrative mode when object includes non-empty items', () => {
    const prose = 'B'.repeat(MIN_NARRATIVE_SKILL_CATEGORY_CHARS);
    expect(() =>
      FormattedSkillsSchema.parse({
        skills_formatted: { Leadership: { narrative: prose, items: ['x'] } },
        missing_skills: [],
        skill_representation_mode: 'narrative',
      })
    ).toThrow();
  });

  it('handler normalizes skills_formatted keys and dedupes recommendations', () => {
    const post = formattedSkillsHandler.postProcessBeforeValidation;
    if (!post) {
      throw new Error('formattedSkillsHandler.postProcessBeforeValidation missing');
    }
    const out = post(
      {
        skills_formatted: {
          'Other (evidenced)': ['x'],
          Other: ['y'],
        },
        missing_skills: [],
        skill_representation_mode: 'keywords',
        section_title_recommendations: [
          { section_kind: 'skills', recommended_section_title: 'First' },
          { section_kind: 'skills', recommended_section_title: 'Second' },
        ],
      },
      {
        inputData: {},
        candidateProfile: null,
        config: {} as any,
        agentId: 'skill_representation_formatter',
        agentName: 'Skill Formatter',
      }
    ) as Record<string, unknown>;

    expect(Object.keys(out.skills_formatted as object)).toEqual(['Other']);
    expect((out.skills_formatted as Record<string, string[]>).Other).toEqual(['x', 'y']);
    expect(out.section_title_recommendations).toEqual([{ section_kind: 'skills', recommended_section_title: 'Second' }]);
  });
});
