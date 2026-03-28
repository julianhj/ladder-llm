const mockResponsesCreate = jest.fn();

jest.mock('../src/recruitment/agents/AgentBuilder', () => ({
  getOpenAIClient: () => ({
    responses: {
      create: mockResponsesCreate,
    },
  }),
  getOpenAIConfig: () => ({
    systemMessage: 'You are an expert extractor.',
    defaultModel: { name: 'gpt-4o-mini', temperature: 0.2, maxTokens: 1000 },
  }),
}));

import { preprocessCVOnly } from '../src/recruitment/preprocessing/PreprocessingAgent';

describe('rerun edited_cv_text preprocessing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResponsesCreate.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                sections: [],
              }),
            },
          ],
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });

  it('passes selected missing skills in structured JSON cv extractor input', async () => {
    await preprocessCVOnly(
      'Jane Doe\nSenior Engineer\nSkills: Node.js, TypeScript',
      '2026-03-19T10-00-00',
      undefined,
      { selectedMissingSkills: ['Kubernetes', 'Terraform'] }
    );

    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
    const requestParams = mockResponsesCreate.mock.calls[0][0];
    const input = typeof requestParams?.input === 'string' ? requestParams.input : '';
    const parsed = JSON.parse(input);
    expect(parsed).toEqual(
      expect.objectContaining({
        input_data: expect.objectContaining({
          unstructured_cv: expect.stringContaining('Jane Doe'),
          selected_missing_skills: ['Kubernetes', 'Terraform'],
        }),
      })
    );
  });
});
