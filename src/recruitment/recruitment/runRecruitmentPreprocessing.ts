import { Logger } from '../utils/Logger.js';
import type { RecruitmentRequest } from '../recruitmentRequest.js';
import type { PreprocessingResult } from '../preprocessing/PreprocessingAgent.js';
import {
  preprocessInputs,
  preprocessCVOnly,
  preprocessJobDescriptionOnly,
  type ResolvedPreprocessingParams,
} from '../preprocessing/PreprocessingAgent.js';
import { structuredCvToProse } from '../preprocessing/structuredCvToProse.js';
import type { RerunOptimizedCvParse } from './parseRerunOptimizedCv.js';
import type { ExecutionTimeTracker } from '../utils/ExecutionTimeTracker.js';

export async function runRecruitmentPreprocessing(
  request: RecruitmentRequest,
  context: { runId: string | null; tracker: ExecutionTimeTracker },
  rerunCvParse: RerunOptimizedCvParse,
  preprocessingParams: ResolvedPreprocessingParams
): Promise<{ preprocessingResult: PreprocessingResult }> {
  const hasEditedCvText = typeof request.edited_cv_text === 'string' && request.edited_cv_text.trim().length > 0;
  const isRerunWithEditedCvText = request.is_rerun_with_updated_cv === true && hasEditedCvText;
  const { runId, tracker } = context;

  if (isRerunWithEditedCvText) {
    Logger.info('main', 'Rerun with edited CV text: extracting CV and job description', {
      cvSize: request.edited_cv_text!.length,
      selectedMissingSkillsCount: Array.isArray(request.selected_missing_skills)
        ? request.selected_missing_skills.length
        : 0,
      jobDescriptionSize: request.job_description.length,
      runId,
      rerunCvPath: 'cv_extract',
      rerunCvSource: request.rerun_cv_source ?? 'unknown',
    });
    try {
      const [cvOnlyResult, jobOnlyResult] = await Promise.all([
        preprocessCVOnly(request.edited_cv_text!, runId, tracker, {
          selectedMissingSkills: request.selected_missing_skills,
          preprocessingParams,
        }),
        preprocessJobDescriptionOnly(request.job_description, runId, tracker, preprocessingParams),
      ]);
      const preprocModel = preprocessingParams.model;
      const preprocessingResult: PreprocessingResult = {
        structured_cv: cvOnlyResult.data,
        structured_job_description: jobOnlyResult.data,
        tokenUsage:
          cvOnlyResult.tokenUsage && jobOnlyResult.tokenUsage
            ? {
                inputTokens: cvOnlyResult.tokenUsage.inputTokens + jobOnlyResult.tokenUsage.inputTokens,
                outputTokens: cvOnlyResult.tokenUsage.outputTokens + jobOnlyResult.tokenUsage.outputTokens,
                totalTokens: cvOnlyResult.tokenUsage.totalTokens + jobOnlyResult.tokenUsage.totalTokens,
                model: preprocModel,
              }
            : cvOnlyResult.tokenUsage ?? jobOnlyResult.tokenUsage,
      };
      Logger.info('main', 'Rerun preprocessing completed (edited CV text + job description)', {
        cvSize: request.edited_cv_text!.length,
        jobDescriptionSize: request.job_description.length,
      });
      return { preprocessingResult };
    } catch (rerunError) {
      Logger.error('main', 'Rerun preprocessing failed', rerunError as Error, {
        cvSize: request.edited_cv_text!.length,
        jobDescriptionSize: request.job_description.length,
      });
      throw new Error(`Rerun preprocessing failed: ${(rerunError as Error).message}`);
    }
  }

  if (
    request.is_rerun_with_updated_cv === true &&
    !hasEditedCvText &&
    rerunCvParse.status === 'valid'
  ) {
    const prose = structuredCvToProse(rerunCvParse.structured, request.selected_missing_skills);
    Logger.info('main', 'Rerun: CV extractor from optimized_cv prose + job description', {
      proseSize: prose.length,
      selectedMissingSkillsCount: Array.isArray(request.selected_missing_skills)
        ? request.selected_missing_skills.length
        : 0,
      jobDescriptionSize: request.job_description.length,
      runId,
      rerunCvPath: 'cv_extract_from_optimized_prose',
      rerunCvSource: request.rerun_cv_source ?? 'unknown',
    });
    try {
      const [cvOnlyResult, jobOnlyResult] = await Promise.all([
        preprocessCVOnly(prose, runId, tracker, { preprocessingParams }),
        preprocessJobDescriptionOnly(request.job_description, runId, tracker, preprocessingParams),
      ]);
      const preprocModel = preprocessingParams.model;
      const preprocessingResult: PreprocessingResult = {
        structured_cv: cvOnlyResult.data,
        structured_job_description: jobOnlyResult.data,
        tokenUsage:
          cvOnlyResult.tokenUsage && jobOnlyResult.tokenUsage
            ? {
                inputTokens: cvOnlyResult.tokenUsage.inputTokens + jobOnlyResult.tokenUsage.inputTokens,
                outputTokens: cvOnlyResult.tokenUsage.outputTokens + jobOnlyResult.tokenUsage.outputTokens,
                totalTokens: cvOnlyResult.tokenUsage.totalTokens + jobOnlyResult.tokenUsage.totalTokens,
                model: preprocModel,
              }
            : cvOnlyResult.tokenUsage ?? jobOnlyResult.tokenUsage,
      };
      Logger.info('main', 'Rerun preprocessing completed (optimized prose + CV extractor + job)', {
        proseSize: prose.length,
        jobDescriptionSize: request.job_description.length,
      });
      return { preprocessingResult };
    } catch (rerunError) {
      Logger.error('main', 'Rerun preprocessing failed', rerunError as Error, {
        proseSize: prose.length,
        jobDescriptionSize: request.job_description.length,
      });
      throw new Error(`Rerun preprocessing failed: ${(rerunError as Error).message}`);
    }
  }

  if (
    request.is_rerun_with_updated_cv === true &&
    !hasEditedCvText &&
    request.optimized_cv != null &&
    rerunCvParse.status === 'invalid'
  ) {
    const detail = rerunCvParse.message;
    throw new Error(
      `Rerun preprocessing failed: invalid optimized_cv and no edited_cv_text fallback (${detail})`
    );
  }

  if (request.file == null || request.file.length === 0) {
    throw new Error(
      'Missing required field: file (CV content). For rerun with updated CV, send edited_cv_text or valid optimized_cv with is_rerun_with_updated_cv.'
    );
  }
  Logger.info('main', 'Starting preprocessing', {
    cvSize: request.file.length,
    jobDescriptionSize: request.job_description.length,
    runId,
    preprocessingPath: 'cv_and_job_description',
    skipCache: request.skip_preprocessing_cache === true,
  });
  try {
    const preprocessingResult = await preprocessInputs(request.file, request.job_description, runId, {
      skipCache: request.skip_preprocessing_cache === true,
      preprocessingParams,
    }, tracker);
    Logger.info('main', 'Preprocessing completed successfully', {
      cvSize: request.file.length,
      jobDescriptionSize: request.job_description.length,
    });
    return { preprocessingResult };
  } catch (preprocessingError) {
    Logger.error('main', 'Preprocessing failed', preprocessingError as Error, {
      cvSize: request.file.length,
      jobDescriptionSize: request.job_description.length,
    });
    throw new Error(`Preprocessing failed: ${(preprocessingError as Error).message}`);
  }
}
