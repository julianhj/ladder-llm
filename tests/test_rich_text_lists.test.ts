import { normalizeStructuredListFields, parseListLikeRichTextBlocks } from '../src/recruitment/agents/AgentBuilder';

describe('rich text list parsing', () => {
  it('parses ordered lists mixed with paragraphs', () => {
    const input = [
      'Points to highlight:',
      '1) Rapid stabilization in high-change environments',
      '2) Durable capability building',
      '3) Service-oriented technology operations',
    ].join('\n');

    const parsed = parseListLikeRichTextBlocks(input);

    expect(parsed).toEqual([
      { type: 'paragraph', text: 'Points to highlight:' },
      {
        type: 'list',
        ordered: true,
        items: [
          'Rapid stabilization in high-change environments',
          'Durable capability building',
          'Service-oriented technology operations',
        ],
      },
    ]);
  });

  it('parses unordered bullet lists', () => {
    const input = [
      'Suggested focus areas:',
      '- SLA governance',
      '- Vendor management',
      '- Risk communications',
    ].join('\n');

    const parsed = parseListLikeRichTextBlocks(input);

    expect(parsed).toEqual([
      { type: 'paragraph', text: 'Suggested focus areas:' },
      { type: 'list', ordered: false, items: ['SLA governance', 'Vendor management', 'Risk communications'] },
    ]);
  });

  it('returns null when there are no list markers', () => {
    const parsed = parseListLikeRichTextBlocks(
      'This is a single paragraph with no numbered or bulleted markers.'
    );
    expect(parsed).toBeNull();
  });

  it('parses inline parenthetical numbering used in ats optimization text', () => {
    const input =
      'Improved ATS match by (1) aligning section language; (2) adding explicit SLA management; and (3) reinforcing governance keywords.';

    const parsed = parseListLikeRichTextBlocks(input);

    expect(parsed).toEqual([
      { type: 'paragraph', text: 'Improved ATS match by' },
      {
        type: 'list',
        ordered: true,
        items: [
          'Aligning section language',
          'Adding explicit SLA management; and',
          'Reinforcing governance keywords.',
        ],
      },
    ]);
  });
});

describe('output normalization for structured lists', () => {
  it('normalizes list-like summary content for assessment sections', () => {
    const summaryText = 'Questions to ask:\n1) How is success defined?\n2) What is the governance cadence?';
    const longBullet = 'Bullet content that is long enough to meet the minimum length requirement for the schema. '.repeat(2);
    const raw = {
      sections: [
        {
          type: 'narrative',
          section_heading: 'Interview Summary',
          section_description: 'Summary of the interview.',
          section_detail: {
            section_detail_summary: summaryText,
            summary_detail_bullets: [longBullet, longBullet],
          },
        },
      ],
    };

    const normalized = normalizeStructuredListFields('assessment', raw) as {
      sections: Array<{ type: string; section_detail: { section_detail_summary: unknown } }>;
    };

    expect(Array.isArray(normalized.sections)).toBe(true);
    expect(normalized.sections[0].type).toBe('narrative');
    expect(Array.isArray(normalized.sections[0].section_detail.section_detail_summary)).toBe(true);
    expect(normalized.sections[0].section_detail.section_detail_summary).toEqual([
      { type: 'paragraph', text: 'Questions to ask:' },
      {
        type: 'list',
        ordered: true,
        items: ['How is success defined?', 'What is the governance cadence?'],
      },
    ]);
  });

  it('normalizes ATS optimization text without touching optimized_cv', () => {
    const raw = {
      optimized_cv: { summary: 'Original CV body must remain untouched' },
      ats_optimization: 'Improvements:\n1) Stronger section alignment\n2) Better parser readability',
      rationale: [{ heading: 'Rationale', summary: 'No list markers here' }],
    };

    const normalized = normalizeStructuredListFields('cv_optimization', raw) as {
      optimized_cv: { summary: string };
      ats_optimization: unknown;
    };

    expect(normalized.optimized_cv.summary).toBe('Original CV body must remain untouched');
    expect(normalized.ats_optimization).toEqual([
      { type: 'paragraph', text: 'Improvements:' },
      {
        type: 'list',
        ordered: true,
        items: ['Stronger section alignment', 'Better parser readability'],
      },
    ]);
  });

});
