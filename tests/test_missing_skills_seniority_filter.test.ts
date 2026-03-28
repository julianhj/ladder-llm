import { filterMissingSkillsBySeniorityContext } from '../src/recruitment/utils/skillRepresentation.js';

describe('filterMissingSkillsBySeniorityContext', () => {
  it('returns list unchanged when gap and inflation are mild', () => {
    const missing = ['TypeScript', 'Kubernetes cluster operations'];
    const out = filterMissingSkillsBySeniorityContext(missing, {
      candidate_seniority_class: 'senior',
      target_seniority_class: 'senior',
      inflation_risk: 20,
    });
    expect(out).toEqual(missing);
  });

  it('drops long JD-shaped lines when candidate is two ranks below target', () => {
    const missing = [
      'TypeScript',
      'Quantified delivery metrics enterprise transformation expertise',
    ];
    const out = filterMissingSkillsBySeniorityContext(missing, {
      candidate_seniority_class: 'intermediate',
      target_seniority_class: 'head',
      inflation_risk: 30,
    });
    expect(out).toEqual(['TypeScript']);
  });

  it('drops long lines when inflation_risk is high', () => {
    const missing = ['Short skill', 'This is an overly long multi word enterprise transformation gap phrase'];
    const out = filterMissingSkillsBySeniorityContext(missing, {
      candidate_seniority_class: 'senior',
      target_seniority_class: 'senior',
      inflation_risk: 70,
    });
    expect(out).toEqual(['Short skill']);
  });
});
