// Common (shared across stages)
export {
  SectionDetailSchema,
  SectionSchema,
  AssessmentSectionTypeEnum,
  AssessmentSectionSchema,
  CandidateProfileSchema,
  InterviewQuestionSchema,
  HeadingSummarySchema,
  RichTextContentSchema,
  AssessmentResultSchema,
  AssessmentResultBaseSchema,
  InterviewAssessmentSchema,
  RecruitmentDecisionOutputSchema,
  normalizeAssessmentScore,
  countInterviewQuestionDifficulties,
  hasBalancedInterviewDifficulties,
  INTERVIEW_QUESTIONS_BALANCE_REFINE_MESSAGE,
  StructuredCVSchema,
  StructuredJobDescriptionSchema,
  Score0To100Schema,
  DecisionEnumSchema,
  StringArraySchema,
  SkillRepresentationModeSchema,
  SeniorityClassSchema,
  SeniorityTrackSchema,
  ScopeLevelSchema,
  ImpactHorizonSchema,
  AmbiguityLevelSchema,
  SIGNAL_AGGREGATED_KEYS,
  SIGNAL_BLOCKS_KEYS,
  SignalCategoryScoresSchema,
  SignalCategoryArraysSchema,
} from './common.js';

export type {
  SectionDetail,
  AssessmentSection,
  RichTextBlock,
  RichTextContent,
  HeadingSummary,
  CandidateProfile,
  InterviewQuestion,
  AssessmentResult,
  InterviewAssessmentResult,
  RecruitmentDecisionOutput,
} from './common.js';

// Stage 0 - Career trajectory
export { CareerTrajectoryProfileSchema } from './stage_0_career_trajectory.js';
export type { CareerTrajectoryProfile } from './stage_0_career_trajectory.js';

// Stage 2 - Role success model
export { RoleSuccessProfileSchema } from './stage_2_role_success_model.js';
export type { RoleSuccessProfile } from './stage_2_role_success_model.js';

// Stage 3 - Interviews use AssessmentResultSchema from common (no separate export)

// Stage 4 - Signal normalisation
export { SignalNormalizedSchema } from './stage_4_signal_normalisation.js';
export type { SignalNormalized } from './stage_4_signal_normalisation.js';

// Stage 5 - Interview calibration
export { CalibratedSignalsSchema } from './stage_5_interview_calibration.js';
export type { CalibratedSignals } from './stage_5_interview_calibration.js';

// Stage 6 - Evidence synthesiser
export { EvidenceSynthesiserSchema } from './stage_6_evidence_synthesiser.js';
export type { EvidenceSynthesiser } from './stage_6_evidence_synthesiser.js';

// Stage 7 - Evidence traceability
export { EvidenceTraceabilitySchema } from './stage_7_evidence_traceability.js';
export type { EvidenceTraceability } from './stage_7_evidence_traceability.js';

// Stage 8 - Panel weighting
export { PanelWeightingSchema } from './stage_8_panel_weighting.js';
export type { PanelWeighting } from './stage_8_panel_weighting.js';

// Stage 10 - Anomaly detection
export { AnomalyDetectionSchema } from './stage_10_anomaly_detection.js';

// Stage 11 - Counterfactual challenge
export { CounterfactualChallengeReportSchema } from './stage_11_counterfactual_challenge.js';
export type { CounterfactualChallengeReport } from './stage_11_counterfactual_challenge.js';

// Stage 12 - Recruiter reality validator
export { RecruiterRealityValidationSchema } from './stage_12_recruiter_reality_validator.js';
export type { RecruiterRealityValidation } from './stage_12_recruiter_reality_validator.js';

// Stage 13 - Seniority signal enforcement
export { SenioritySignalEnforcementSchema } from './stage_13_seniority_signal_enforcement.js';
export type { SenioritySignalEnforcement } from './stage_13_seniority_signal_enforcement.js';

// Stage 14 - Consensus decision
export {
  CvRewriteStrategySchema,
  ConsensusResultSchema,
} from './stage_14_consensus_decision.js';
export type { CvRewriteStrategy, ConsensusResult } from './stage_14_consensus_decision.js';

// Stage 15 - Final decision
export {
  CV_SECTION_HELP_KEYS,
  CVOptimizationResultSchema,
  EvidenceValidatedSchema,
  EnforcedClaimsSchema,
  SectionTitleRecommendationSchema,
  FormattedSkillsSchema,
  MIN_NARRATIVE_SKILL_CATEGORY_CHARS,
  FormattedExperienceSchema,
  FormattedExperienceRowSchema,
  ProfileNarrativeRewriteSchema,
  RewrittenSectionsSchema,
  RoleFitSummarySchema,
  InterviewFeedbackSummarySchema,
  CareerGuidanceResultSchema,
  FinalDecisionResultSchema,
} from './stage_15_final_decision.js';
export type {
  CVOptimizationResult,
  ProfileNarrativeRewriteResult,
  InterviewFeedbackSummary,
  CareerGuidanceResult,
  FinalDecisionResult,
} from './stage_15_final_decision.js';

