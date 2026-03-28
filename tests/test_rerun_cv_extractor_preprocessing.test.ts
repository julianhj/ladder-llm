import { runRecruitmentPreprocessing } from '../src/recruitment/recruitment/runRecruitmentPreprocessing';
import { parseRerunOptimizedCv } from '../src/recruitment/recruitment/parseRerunOptimizedCv';
import type { RecruitmentRequest } from '../src/recruitment/recruitmentRequest';
import * as PreprocessingAgent from '../src/recruitment/preprocessing/PreprocessingAgent';
import type { OpenAIConfig } from '../src/recruitment/loaders/ConfigLoader';
import { validateStructuredCV } from '../src/recruitment/utils/cvConverter';
import { ExecutionTimeTracker } from '../src/recruitment/utils/ExecutionTimeTracker';

const testOpenaiForPreproc: OpenAIConfig = {
  defaultModel: { name: 'gpt-4o-mini', temperature: 0.2, maxTokens: 1000 },
};
const testPreprocessingParams = PreprocessingAgent.resolvePreprocessingParams(
  undefined,
  testOpenaiForPreproc
);

jest.mock('../src/recruitment/preprocessing/PreprocessingAgent', () => ({
  ...jest.requireActual<typeof import('../src/recruitment/preprocessing/PreprocessingAgent')>(
    '../src/recruitment/preprocessing/PreprocessingAgent'
  ),
  preprocessInputs: jest.fn(),
  preprocessCVOnly: jest.fn(),
  preprocessJobDescriptionOnly: jest.fn(),
}));

const mockJobDescription = { role_title: 'Engineer', company: 'Acme Corp' };

function minimalRerunOptimizedCv() {
  return validateStructuredCV({
    sections: [
      {
        section_title: 'Skills',
        kind: 'skills',
        content: { groups: [{ heading: 'Skills', items: ['Rust'] }] },
      },
    ],
  });
}

describe('rerun always runs CV extractor (no optimized_cv direct structured_cv)', () => {
  let ctx: { runId: string; tracker: ExecutionTimeTracker };

  beforeEach(() => {
    jest.clearAllMocks();
    const tracker = new ExecutionTimeTracker();
    tracker.initialize('2026-03-11T12-00-00-000-test', Date.now());
    ctx = { runId: '2026-03-11T12-00-00-000-test', tracker };
    (PreprocessingAgent.preprocessJobDescriptionOnly as jest.Mock).mockResolvedValue({
      data: mockJobDescription,
      tokenUsage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });
    (PreprocessingAgent.preprocessCVOnly as jest.Mock).mockResolvedValue({
      data: minimalRerunOptimizedCv(),
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it('calls preprocessCVOnly with edited_cv_text when both optimized_cv and edited_cv_text are present', async () => {
    const optimized_cv = minimalRerunOptimizedCv();
    const edited = 'Long prose that must go through the CV extractor.';
    const request: RecruitmentRequest = {
      is_rerun_with_updated_cv: true,
      optimized_cv,
      edited_cv_text: edited,
      candidate_name: 'Test User',
      candidate_email: 'test@example.com',
      company_name: 'Acme',
      role_applying_for: 'Engineer',
      job_description: 'Build systems.',
      job_posted_by_recruiter: false,
    };

    const rerunCvParse = parseRerunOptimizedCv(request);
    await runRecruitmentPreprocessing(request, ctx, rerunCvParse, testPreprocessingParams);

    expect(PreprocessingAgent.preprocessCVOnly).toHaveBeenCalledTimes(1);
    expect(PreprocessingAgent.preprocessCVOnly).toHaveBeenCalledWith(
      edited,
      ctx.runId,
      ctx.tracker,
      { selectedMissingSkills: undefined, preprocessingParams: testPreprocessingParams }
    );
    expect(PreprocessingAgent.preprocessJobDescriptionOnly).toHaveBeenCalledTimes(1);
    expect(PreprocessingAgent.preprocessJobDescriptionOnly).toHaveBeenCalledWith(
      request.job_description,
      ctx.runId,
      ctx.tracker,
      testPreprocessingParams
    );
  });

  it('calls preprocessCVOnly with deterministic prose when valid optimized_cv and no edited_cv_text', async () => {
    const optimized_cv = minimalRerunOptimizedCv();
    const request: RecruitmentRequest = {
      is_rerun_with_updated_cv: true,
      optimized_cv,
      candidate_name: 'Test User',
      candidate_email: 'test@example.com',
      company_name: 'Acme',
      role_applying_for: 'Engineer',
      job_description: 'Build systems.',
      job_posted_by_recruiter: false,
    };

    const rerunCvParse = parseRerunOptimizedCv(request);
    await runRecruitmentPreprocessing(request, ctx, rerunCvParse, testPreprocessingParams);

    expect(PreprocessingAgent.preprocessCVOnly).toHaveBeenCalledTimes(1);
    const proseArg = (PreprocessingAgent.preprocessCVOnly as jest.Mock).mock.calls[0][0] as string;
    expect(proseArg).toContain('Rust');
    expect(PreprocessingAgent.preprocessCVOnly).toHaveBeenCalledWith(proseArg, ctx.runId, ctx.tracker, {
      preprocessingParams: testPreprocessingParams,
    });
    expect(PreprocessingAgent.preprocessJobDescriptionOnly).toHaveBeenCalledTimes(1);
  });

  it('throws when rerun has invalid optimized_cv and no edited_cv_text', async () => {
    const request: RecruitmentRequest = {
      is_rerun_with_updated_cv: true,
      optimized_cv: { not: 'structured_cv' },
      candidate_name: 'Test User',
      candidate_email: 'test@example.com',
      company_name: 'Acme',
      role_applying_for: 'Engineer',
      job_description: 'Build systems.',
      job_posted_by_recruiter: false,
    };

    const rerunCvParse = parseRerunOptimizedCv(request);
    await expect(
      runRecruitmentPreprocessing(request, ctx, rerunCvParse, testPreprocessingParams)
    ).rejects.toThrow(/invalid optimized_cv/);
    expect(PreprocessingAgent.preprocessCVOnly).not.toHaveBeenCalled();
  });
});
