import { z } from 'zod';
import {
  AssessmentResultSchema,
  InterviewAssessmentSchema,
  AnomalyDetectionSchema,
  CareerGuidanceResultSchema,
  ConsensusResultSchema,
  CVOptimizationResultSchema,
  EvidenceValidatedSchema,
  EnforcedClaimsSchema,
  FormattedSkillsSchema,
  FormattedExperienceSchema,
  ProfileNarrativeRewriteSchema,
  RewrittenSectionsSchema,
  RoleFitSummarySchema,
  EvidenceSynthesiserSchema,
  FinalDecisionResultSchema,
  PanelWeightingSchema,
  RecruiterRealityValidationSchema,
  SenioritySignalEnforcementSchema,
  SignalNormalizedSchema,
  CareerTrajectoryProfileSchema,
  RoleSuccessProfileSchema,
  EvidenceTraceabilitySchema,
  CalibratedSignalsSchema,
  CounterfactualChallengeReportSchema,
  StructuredCVSchema,
  StructuredJobDescriptionSchema,
} from './schemas/index.js';

export type OutputSchemaName =
  | 'assessment'
  | 'interview_assessment'
  | 'cv_optimization'
  | 'career_guidance'
  | 'final_decision'
  | 'consensus'
  | 'signal_normalized'
  | 'recruiter_reality_validation'
  | 'evidence_synthesiser'
  | 'panel_weighting'
  | 'anomaly_detection'
  | 'seniority_signal_enforcement'
  | 'evidence_validated'
  | 'enforced_claims'
  | 'formatted_skills'
  | 'formatted_experience'
  | 'profile_narrative_rewrite'
  | 'rewritten_sections'
  | 'role_fit_summary'
  | 'career_trajectory_profile'
  | 'role_success_profile'
  | 'evidence_traceability'
  | 'calibrated_signals'
  | 'counterfactual_challenge_report'
  | 'optimized_structured_cv'
  | 'structured_job_description';

const schemaMap: Record<OutputSchemaName, z.ZodTypeAny> = {
  assessment: AssessmentResultSchema,
  interview_assessment: InterviewAssessmentSchema,
  cv_optimization: CVOptimizationResultSchema,
  career_guidance: CareerGuidanceResultSchema,
  final_decision: FinalDecisionResultSchema,
  consensus: ConsensusResultSchema,
  signal_normalized: SignalNormalizedSchema,
  recruiter_reality_validation: RecruiterRealityValidationSchema,
  evidence_synthesiser: EvidenceSynthesiserSchema,
  panel_weighting: PanelWeightingSchema,
  anomaly_detection: AnomalyDetectionSchema,
  seniority_signal_enforcement: SenioritySignalEnforcementSchema,
  evidence_validated: EvidenceValidatedSchema,
  enforced_claims: EnforcedClaimsSchema,
  formatted_skills: FormattedSkillsSchema,
  formatted_experience: FormattedExperienceSchema,
  profile_narrative_rewrite: ProfileNarrativeRewriteSchema,
  rewritten_sections: RewrittenSectionsSchema,
  role_fit_summary: RoleFitSummarySchema,
  career_trajectory_profile: CareerTrajectoryProfileSchema,
  role_success_profile: RoleSuccessProfileSchema,
  evidence_traceability: EvidenceTraceabilitySchema,
  calibrated_signals: CalibratedSignalsSchema,
  counterfactual_challenge_report: CounterfactualChallengeReportSchema,
  optimized_structured_cv: StructuredCVSchema,
  structured_job_description: StructuredJobDescriptionSchema,
};

/**
 * Return the Zod schema for the given output schema name.
 * Trims whitespace (bad JSON / copy-paste). Throws if unknown so we never silently validate with `assessment`.
 */
export function getSchema(name: string): z.ZodSchema {
  const key = (typeof name === 'string' ? name.trim() : String(name)) as OutputSchemaName;
  const schema = schemaMap[key];
  if (schema === undefined) {
    const valid = (Object.keys(schemaMap) as string[]).sort().join(', ');
    throw new Error(
      `Unknown outputSchema "${name}". Add it to schemaMap in schemaRegistry.ts or fix agents.json. Valid names: ${valid}`
    );
  }
  return schema;
}
