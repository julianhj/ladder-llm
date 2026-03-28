import { CVDisplaySectionSchema, StructuredCVSchema } from '../src/recruitment/schemas/StructuredInputs.js';

describe('CVDisplaySectionSchema', () => {
  it('accepts certifications section with items', () => {
    const parsed = CVDisplaySectionSchema.parse({
      section_title: 'Certifications',
      kind: 'certifications',
      content: { items: ['AWS Certified Solutions Architect - Professional', 'AWS Certified Developer - Associate'] },
    });
    expect(parsed.kind).toBe('certifications');
    if (parsed.kind === 'certifications') {
      expect(parsed.content.items).toHaveLength(2);
    }
  });

  it('accepts awards section and coerces item types to strings', () => {
    const parsed = CVDisplaySectionSchema.parse({
      section_title: 'Awards',
      kind: 'awards',
      content: { items: ['Technology Emmy', 2024] },
    });
    expect(parsed.kind).toBe('awards');
    if (parsed.kind === 'awards') {
      expect(parsed.content.items[1]).toBe('2024');
    }
  });

  it('accepts certifications with object-shaped items (name + issuer)', () => {
    const parsed = CVDisplaySectionSchema.parse({
      section_title: 'Professional Certifications',
      kind: 'certifications',
      content: {
        items: [{ name: 'AWS Solutions Architect', issuer: 'Amazon' }, { name: 'CKA', issuer: 'CNCF' }],
      },
    });
    expect(parsed.kind).toBe('certifications');
    if (parsed.kind === 'certifications') {
      expect(parsed.content.items).toEqual([
        'AWS Solutions Architect (Amazon)',
        'CKA (CNCF)',
      ]);
    }
  });

  it('accepts awards with title + organization + year objects', () => {
    const parsed = CVDisplaySectionSchema.parse({
      section_title: 'Selected Awards',
      kind: 'awards',
      content: {
        items: [{ title: 'Best Paper', organization: 'ACM', year: 2023 }],
      },
    });
    expect(parsed.kind).toBe('awards');
    if (parsed.kind === 'awards') {
      expect(parsed.content.items).toEqual(['Best Paper (ACM) - 2023']);
    }
  });

  it('accepts list sections with object items', () => {
    const parsed = CVDisplaySectionSchema.parse({
      section_title: 'Professional Certifications',
      kind: 'list',
      content: { items: [{ name: 'PMP', issuer: 'PMI' }] },
    });
    expect(parsed.kind).toBe('list');
    if (parsed.kind === 'list') {
      expect(parsed.content.items).toEqual(['PMP (PMI)']);
    }
  });

  it('parses structured CV containing certifications and awards', () => {
    const parsed = StructuredCVSchema.parse({
      header: { full_name: 'Test' },
      sections: [
        {
          section_title: 'Certifications',
          kind: 'certifications',
          content: { items: ['Cert A'] },
        },
        {
          section_title: 'Awards',
          kind: 'awards',
          content: { items: ['Award B'] },
        },
      ],
    });
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].kind).toBe('certifications');
    expect(parsed.sections[1].kind).toBe('awards');
  });
});
