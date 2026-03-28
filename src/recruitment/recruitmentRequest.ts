/**
 * API contract for recruitment pipeline entry (shared by api-server and openai package).
 */
export interface RecruitmentRequest {
  /**
   * CV file content as string (first-run upload). For rerun, use `edited_cv_text` and/or `optimized_cv`
   * with `is_rerun_with_updated_cv`; `file` is not required on rerun when those are provided.
   */
  file?: string;
  candidate_name: string;
  candidate_email: string;
  company_name: string;
  role_applying_for: string;
  job_description: string;
  criticality_level?: string;
  verbosity_level?: string;
  cv_optimization_level?: string;
  audience_perspective?: 'candidate' | 'hiring_organisation';
  /** When true, the job is advertised by a recruiter (not the hiring company); company_name is ignored and Background stage is skipped. */
  job_posted_by_recruiter?: boolean;
  is_rerun_with_updated_cv?: boolean;
  cv_optimization_rerun_count?: number;
  previous_run_scores?: Record<string, number>;
  previous_optimization_did_not_improve_scores?: boolean;
  /** Previous run's final hiring decision (for rerun; passed to LLM so it can aim for same or stronger outcome). */
  previous_final_decision?: 'hire' | 'maybe' | 'declined';
  /** Previous run's final decision confidence 0-100 (optional). */
  previous_final_confidence?: number;
  /** Candidate-selected missing skills to incorporate into rerun CV optimization. */
  selected_missing_skills?: string[];
  /** Frontend trace marker for rerun CV source path. */
  rerun_cv_source?: 'edited' | 'previousOptimized';
  /** Rerun path: edited CV text passed back for fresh structured CV extraction. */
  edited_cv_text?: string;
  /** Rerun: previous run's optimized CV JSON (same schema as structured_cv). */
  optimized_cv?: unknown;
  /** CV Optimizer v2.3+: hash from previous run's cv_optimization.previous_optimized_cv_hash for idempotent reruns. */
  previous_optimized_cv_hash?: string;
  /** When true, skip preprocessing cache for this request (force fresh CV extraction). Use to verify full-role extraction after prompt changes. */
  skip_preprocessing_cache?: boolean;
}
