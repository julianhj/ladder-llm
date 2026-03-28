import { buildEvidence } from '../src/recruitment/logic/signal_layer/buildEvidence';

describe('buildEvidence declared-skills relaxation', () => {
  it('maps skills text to multiple signal keys and keeps skills confidence lower than experience', () => {
    const skillsKind = 'skills';
    const experienceKind = 'experience';
    const structuredCV = {
      sections: [
        {
          kind: skillsKind,
          section_title: 'Skills',
          content: {
            groups: [
              {
                heading: 'Core Skills',
                items: ['Technical architecture', 'Leadership mentoring', 'Business alignment'],
              },
            ],
          },
        },
        {
          kind: experienceKind,
          section_title: 'Experience',
          content: {
            items: [
              {
                role: 'Engineering Manager',
                company: 'Acme',
                responsibilities: ['Led delivery planning and execution across teams'],
              },
            ],
          },
        },
      ],
    };

    const evidence = buildEvidence(structuredCV, null);
    const skillsEvidence = evidence.filter((item) => item.source_section === 'skills');
    const experienceEvidence = evidence.filter((item) => item.source_section === 'experience');

    const skillKeys = new Set(skillsEvidence.map((item) => item.signal_key));
    expect(skillKeys.has('execution.technical')).toBe(true);
    expect(skillKeys.has('leadership.leadership')).toBe(true);
    expect(skillKeys.has('business.business_alignment')).toBe(true);

    expect(skillsEvidence.length).toBeGreaterThan(1);
    expect(skillsEvidence.every((item) => item.confidence === 50)).toBe(true);
    expect(experienceEvidence.length).toBeGreaterThan(0);
    expect(experienceEvidence.every((item) => item.confidence === 75)).toBe(true);
  });

  it('dedupes identical evidence entries when multiple matches overlap', () => {
    const skillsKind = 'skills';
    const structuredCV = {
      sections: [
        {
          kind: skillsKind,
          section_title: 'Skills',
          content: {
            groups: [
              {
                heading: 'Skills',
                items: ['delivery delivery execution'],
              },
            ],
          },
        },
      ],
    };

    const evidence = buildEvidence(structuredCV, null);
    const keys = evidence.map((item) => `${item.signal_key}|${item.source_section}|${item.excerpt}`);
    const unique = new Set(keys);

    expect(unique.size).toBe(keys.length);
  });
});
