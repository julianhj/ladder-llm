import {
  collectSkillsFromOptimizedCv,
  enforceSkillsSectionFormat,
  normalizeMissingSkills,
  validateSkillFormat,
} from '../src/recruitment/utils/skillRepresentation';

describe('normalizeMissingSkills', () => {
  it('returns empty array for null, undefined, or non-array', () => {
    expect(normalizeMissingSkills(null, 'keywords')).toEqual([]);
    expect(normalizeMissingSkills(undefined, 'keywords')).toEqual([]);
    expect(normalizeMissingSkills([], 'keywords')).toEqual([]);
  });

  it('keywords mode: strips tier-3 and diagnostics, takes first comma part', () => {
    expect(normalizeMissingSkills(['Tier-3 diagnostics, other'], 'keywords')).toEqual([]);
    expect(normalizeMissingSkills(['diagnostic tooling'], 'keywords')).toEqual(['tooling']);
    expect(normalizeMissingSkills(['Release discipline, governance'], 'keywords')).toEqual(['Release discipline']);
  });

  it('narrative mode: returns trimmed non-empty items as-is', () => {
    const input = ['Led cross-functional teams', 'Stakeholder management'];
    expect(normalizeMissingSkills(input, 'narrative')).toEqual(['Led cross-functional teams', 'Stakeholder management']);
  });
});

describe('validateSkillFormat', () => {
  it('does not warn for keywords mode when all items are short', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    validateSkillFormat(['React', 'TypeScript', 'Node.js'], 'keywords');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns when keyword mode has sentence-like items', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    validateSkillFormat(['React', 'Led cross-functional teams and delivered on time'], 'keywords');
    expect(warn).toHaveBeenCalledWith('Narrative skills detected in keyword mode', expect.objectContaining({ count: 1 }));
    warn.mockRestore();
  });

  it('does not warn for narrative mode', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    validateSkillFormat(['Led cross-functional teams and delivered on time'], 'narrative');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('enforceSkillsSectionFormat', () => {
  it('keyword mode: tokenises long skill items', () => {
    const optimizedCv = {
      sections: [
        {
          kind: 'skills',
          content: {
            groups: [
              {
                heading: 'Technical',
                items: [
                  'React',
                  'Led cross-functional teams and delivered projects on time and budget',
                ],
              },
            ],
          },
        },
      ],
    };
    enforceSkillsSectionFormat(optimizedCv as any, 'keywords');
    const section = (optimizedCv as any).sections[0];
    const items = section.content.groups[0].items;
    expect(items).toContain('React');
    expect(items.length).toBeGreaterThan(2);
    const maxWords = Math.max(...items.map((s: string) => s.split(/\s+/).length));
    expect(maxWords).toBeLessThanOrEqual(6);
  });

  it('narrative mode: leaves items unchanged', () => {
    const optimizedCv = {
      sections: [
        {
          kind: 'skills',
          content: {
            groups: [{ heading: 'Technical', items: ['React', 'TypeScript', 'Led delivery across teams'] }],
          },
        },
      ],
    };
    const before = JSON.stringify((optimizedCv as any).sections[0].content.groups[0].items);
    enforceSkillsSectionFormat(optimizedCv as any, 'narrative');
    const after = JSON.stringify((optimizedCv as any).sections[0].content.groups[0].items);
    expect(after).toBe(before);
  });

  it('handles empty sections and categories format', () => {
    const optimizedCv = { sections: [] };
    expect(() => enforceSkillsSectionFormat(optimizedCv as any, 'keywords')).not.toThrow();
  });
});

describe('collectSkillsFromOptimizedCv', () => {
  it('collects items from groups', () => {
    const optimizedCv = {
      sections: [
        {
          kind: 'skills',
          content: {
            groups: [
              { heading: 'A', items: ['x', 'y'] },
              { heading: 'B', items: ['z'] },
            ],
          },
        },
      ],
    };
    expect(collectSkillsFromOptimizedCv(optimizedCv as any)).toEqual(['x', 'y', 'z']);
  });

  it('collects from categories when groups missing', () => {
    const optimizedCv = {
      sections: [
        {
          kind: 'skills',
          content: {
            categories: [
              { category_name: 'Tech', skills: ['React', 'Node'] },
            ],
          },
        },
      ],
    };
    expect(collectSkillsFromOptimizedCv(optimizedCv as any)).toEqual(['React', 'Node']);
  });

  it('returns empty for no sections or no skills sections', () => {
    expect(collectSkillsFromOptimizedCv({ sections: [] } as any)).toEqual([]);
    expect(collectSkillsFromOptimizedCv({ sections: [{ kind: 'summary', content: {} }] } as any)).toEqual([]);
  });
});
