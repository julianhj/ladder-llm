import { stripSkillHeadingMetadata } from '../src/recruitment/utils/stripSkillHeadingMetadata';

describe('stripSkillHeadingMetadata', () => {
  it('removes trailing (evidenced) and similar assessment suffixes', () => {
    expect(stripSkillHeadingMetadata('Cloud & delivery practices (evidenced)')).toBe('Cloud & delivery practices');
    expect(stripSkillHeadingMetadata('Tools (provisional)')).toBe('Tools');
    expect(stripSkillHeadingMetadata('Leadership (declared only)')).toBe('Leadership');
    expect(stripSkillHeadingMetadata('Skills (lower confidence)')).toBe('Skills');
    expect(stripSkillHeadingMetadata('X (needs evidence)')).toBe('X');
    expect(stripSkillHeadingMetadata('Y (explicit ramp-up)')).toBe('Y');
  });

  it('strips chained metadata parens', () => {
    expect(stripSkillHeadingMetadata('Area (evidenced) (provisional)')).toBe('Area');
  });

  it('does not strip benign geographic or product qualifiers', () => {
    expect(stripSkillHeadingMetadata('Markets (UK)')).toBe('Markets (UK)');
    expect(stripSkillHeadingMetadata('Platforms (SaaS)')).toBe('Platforms (SaaS)');
  });

  it('returns empty input unchanged', () => {
    expect(stripSkillHeadingMetadata('')).toBe('');
  });
});
