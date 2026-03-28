import { reconcileOptimizedExperienceEntries } from '../src/recruitment/agents/AgentBuilder';
import { validateStructuredCV } from '../src/recruitment/utils/cvConverter';

describe('CV experience preservation', () => {
  it('reconciles missing experience entries from source CV regardless of age', () => {
    const optimizedCv: Record<string, unknown> = {
      sections: [
        {
          id: 'section-1',
          section_title: 'Experience',
          kind: 'experience',
          content: {
            items: [
              {
                company: 'Recent Employer',
                position: 'Head of Engineering',
                duration: '2021-2025',
                description: 'Led platform modernization.',
              },
            ],
          },
        },
      ],
    };

    const sourceExperience = [
      { company: 'Recent Employer', role: 'Head of Engineering', period: '2021-2025', tags: ['Platform modernization'] },
      { company: 'Nedbank', role: 'Executive: Managed Services', period: '2014-2016', tags: ['Managed services leadership'] },
      { company: 'Standard Bank Group', role: 'Head: Technology Services', period: '2008-2014', tags: ['Technology services'] },
    ];

    const result = reconcileOptimizedExperienceEntries(optimizedCv, sourceExperience);
    const sections = optimizedCv.sections as Array<Record<string, unknown>>;
    const experienceSection = sections.find((section) => section.kind === 'experience') as Record<string, unknown>;
    const items = ((experienceSection.content as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;

    expect(result.sourceExperienceCount).toBe(3);
    expect(result.optimizedExperienceCountBeforeRepair).toBe(1);
    expect(result.optimizedExperienceCountAfterRepair).toBe(3);
    expect(result.recoveredEntries).toEqual([
      { company: 'Nedbank', role: 'Executive: Managed Services' },
      { company: 'Standard Bank Group', role: 'Head: Technology Services' },
    ]);
    expect(items.map((item) => String(item.company ?? ''))).toEqual([
      'Recent Employer',
      'Nedbank',
      'Standard Bank Group',
    ]);
  });

  it('keeps section-based CV through validateStructuredCV rerun path', () => {
    const converted = validateStructuredCV({
      header: {
        full_name: 'Julian Hambleton-Jones',
        professional_title: 'Transformation Leader',
      },
      sections: [
        {
          id: 'experience-1',
          section_title: 'Experience',
          kind: 'experience',
          content: {
            items: [
              {
                company: 'Nedbank',
                position: 'Executive: Managed Services',
                duration: '2014-2016',
                responsibilities: ['Built managed service operating model'],
              },
              {
                company: 'Standard Bank Group',
                role: 'Head: Technology Services',
                period: '2008-2014',
                description: 'Led enterprise technology services teams.',
              },
            ],
          },
        },
      ],
    });

    expect(converted.sections).toHaveLength(1);
    const experienceSection = converted.sections.find((s) => s.kind === 'experience');
    expect(experienceSection).toBeDefined();
    expect(experienceSection!.kind).toBe('experience');
    const items = (experienceSection as { kind: 'experience'; content: { items: unknown[] } }).content.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      company: 'Nedbank',
      position: 'Executive: Managed Services',
      duration: '2014-2016',
    });
    expect(items[1]).toMatchObject({
      company: 'Standard Bank Group',
      role: 'Head: Technology Services',
      period: '2008-2014',
    });
  });

  it('restores newly added roles when optimizer output omits them', () => {
    const optimizedCv: Record<string, unknown> = {
      sections: [
        {
          id: 'section-1',
          section_title: 'Experience',
          kind: 'experience',
          content: {
            items: [
              {
                company: 'Current Co',
                position: 'Engineering Manager',
                duration: '2022-present',
              },
            ],
          },
        },
      ],
    };

    const sourceExperience = [
      { company: 'Current Co', role: 'Engineering Manager', period: '2022-present' },
      { company: 'New Startup', role: 'VP Engineering', period: '2025-present' },
    ];

    const result = reconcileOptimizedExperienceEntries(optimizedCv, sourceExperience);
    const sections = optimizedCv.sections as Array<Record<string, unknown>>;
    const experienceSection = sections.find((section) => section.kind === 'experience') as Record<string, unknown>;
    const items = ((experienceSection.content as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>;

    expect(result.recoveredEntries).toEqual([{ company: 'New Startup', role: 'VP Engineering' }]);
    expect(items.map((item) => String(item.company ?? ''))).toEqual(['Current Co', 'New Startup']);
  });
});
