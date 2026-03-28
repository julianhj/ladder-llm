import { validateStructuredCV } from '../src/recruitment/utils/cvConverter';
import { mergeSelectedMissingSkillsIntoStructuredCv } from '../src/recruitment/utils/mergeSelectedMissingSkillsIntoStructuredCv';
import { normalizeMissingSkills } from '../src/recruitment/utils/skillRepresentation';

describe('mergeSelectedMissingSkillsIntoStructuredCv', () => {
  it('adds selected skills as keyword items when skills section exists', () => {
    const cv = validateStructuredCV({
      sections: [
        {
          section_title: 'Skills',
          kind: 'skills',
          content: { groups: [{ heading: 'Skills', items: ['TypeScript'] }] },
        },
      ],
    });
    const added = mergeSelectedMissingSkillsIntoStructuredCv(cv, normalizeMissingSkills(['Kubernetes', 'Terraform'], 'keywords'), {
      skillMode: 'keywords',
    });
    expect(added).toEqual(['Kubernetes', 'Terraform']);
    const sections = (cv as { sections: Array<{ kind?: string; content?: { groups?: Array<{ items?: string[] }> } }> })
      .sections;
    const skills = sections.find((s) => s.kind === 'skills');
    const items = skills?.content?.groups?.flatMap((g) => g.items ?? []) ?? [];
    expect(items).toEqual(expect.arrayContaining(['TypeScript', 'Kubernetes', 'Terraform']));
  });

  it('places selected skills into an existing group when heading and items overlap', () => {
    const cv = validateStructuredCV({
      sections: [
        {
          section_title: 'Skills',
          kind: 'skills',
          content: {
            groups: [
              {
                heading: 'Cloud and platform',
                items: ['AWS', 'Kubernetes'],
                narrative:
                  'Hands-on work across AWS and Kubernetes for production services, including EKS networking and cluster hardening.',
              },
            ],
          },
        },
      ],
    });
    const added = mergeSelectedMissingSkillsIntoStructuredCv(cv, ['EKS networking policies'], {
      skillMode: 'narrative',
      targetSeniorityClass: 'senior',
    });
    expect(added).toEqual(['EKS networking policies']);
    const groups = (cv as { sections: Array<{ content?: { groups?: Array<{ heading?: string; narrative?: string }> } }> })
      .sections[0].content?.groups;
    expect(groups?.some((g) => g.heading === 'Cloud and platform')).toBe(true);
    const cloud = groups?.find((g) => g.heading === 'Cloud and platform');
    expect(String(cloud?.narrative ?? '').toLowerCase()).toContain('policies');
  });

  it('creates a skills section when missing', () => {
    const cv = validateStructuredCV({
      sections: [
        {
          section_title: 'Summary',
          kind: 'summary',
          content: { text: 'Engineer' },
        },
      ],
    });
    mergeSelectedMissingSkillsIntoStructuredCv(cv, ['Go'], { skillMode: 'keywords' });
    const sections = (cv as { sections: Array<{ kind?: string }> }).sections;
    expect(sections.some((s) => s.kind === 'skills')).toBe(true);
  });
});
