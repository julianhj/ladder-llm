import { structuredCvToProse } from '../src/recruitment/preprocessing/structuredCvToProse.js';
import type { StructuredCV } from '../src/recruitment/schemas/StructuredInputs.js';

describe('structuredCvToProse', () => {
  const minimalCv: StructuredCV = {
    header: {
      full_name: 'Jane Doe',
      professional_title: 'Engineering Manager',
      contact: {
        email: 'jane@example.com',
        phone: '+44 7700 900000',
        location: 'London',
      },
    },
    sections: [
      {
        section_title: 'Summary',
        kind: 'summary',
        content: { text: 'Experienced leader in platform teams.' },
      },
      {
        section_title: 'Skills',
        kind: 'skills',
        content: {
          groups: [
            { heading: 'Technical', items: ['TypeScript', 'Node.js'] },
            { heading: 'Leadership', narrative: 'Team building and delivery.' },
          ],
        },
      },
      {
        section_title: 'Experience',
        kind: 'experience',
        content: {
          items: [
            {
              company: 'Acme Ltd',
              position: 'Head of Engineering',
              duration: '2020–2024',
              responsibilities: ['Led platform migration', 'Hired and mentored engineers'],
            },
          ],
        },
      },
    ],
  };

  it('includes header, sections, and stable structure', () => {
    const prose = structuredCvToProse(minimalCv);
    expect(prose).toContain('Jane Doe');
    expect(prose).toContain('Engineering Manager');
    expect(prose).toContain('jane@example.com');
    expect(prose).toContain('Summary');
    expect(prose).toContain('TypeScript');
    expect(prose).toContain('Acme Ltd');
    expect(prose).toContain('Led platform migration');
  });

  it('appends candidate-requested skills block when provided', () => {
    const prose = structuredCvToProse(minimalCv, ['Kubernetes', 'Terraform']);
    expect(prose).toContain('for each token, first check if an existing Skills group above is suitable');
    expect(prose).toContain('- Kubernetes');
    expect(prose).toContain('- Terraform');
  });

  it('omits additions block when selected list is empty', () => {
    const prose = structuredCvToProse(minimalCv, []);
    expect(prose).not.toContain('Additional skill tokens');
  });

  it('handles education and list sections', () => {
    const cv: StructuredCV = {
      sections: [
        {
          section_title: 'Education',
          kind: 'education',
          content: {
            items: [{ degree: 'MSc Computer Science', institution: 'Example University' }],
          },
        },
        {
          section_title: 'Certifications',
          kind: 'list',
          content: { items: ['AWS SA', 'CKA'] },
        },
      ],
    };
    const prose = structuredCvToProse(cv);
    expect(prose).toContain('MSc Computer Science');
    expect(prose).toContain('Example University');
    expect(prose).toContain('- AWS SA');
    expect(prose).toContain('- CKA');
  });
});
