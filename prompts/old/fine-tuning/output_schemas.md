# Output Schemas Extracted from Prompts

This document lists all output schemas found in the prompts.
Common schemas (used by multiple agents) are shown only once.

Generated: 2026-02-12T21:01:44.212Z

---

## AssessmentResult

**Common Schema** - Used by 6 agents:
- Consensus Decision Maker
- Technical Interviewer
- Soft Skills Interviewer
- Leadership Interviewer
- Recruiter
- Hiring Manager

**Input Fields:**
- candidateCV (string) - Candidate CV/resume content
- jobDescription (string) - Job description and requirements
- name (string) - Candidate name
- email (string) - Candidate email
- company_name (string) - Company name
- role_applying_for (string) - Role being applied for
- criticality_level (enum) - Assessment criticality level
- previousStageResults (object, optional) - Results from previous stage (for Consensus Decision Maker)

**Output Fields:**
- decision (hire|declined|maybe)
- score (0-100)
- narrative (optional: string min 10 chars OR array of { heading, summary } - interviewers)
- consensus_assessment (optional, array of { heading, summary } - consensus agent)
- strengths (array)
- concerns (array)
- recommendations (array)
- growth_potential (min 10 chars)
- leadership_level (min 20 chars)
- cultural_fit_level (min 10 chars)
- team_integration_potential (min 10 chars)
- interview_questions (optional array)

---

## ConsensusResult

**Common Schema** - Used by 3 agents:
- consensus_decision_maker.v1.3.0
- consensus_decision_maker.v1.3.1
- Consensus Decision Maker

**Input Fields:**
- candidateCV (string) - Candidate CV/resume content
- jobDescription (string) - Job description and requirements
- name (string) - Candidate name
- email (string) - Candidate email
- company_name (string) - Company name
- role_applying_for (string) - Role being applied for
- criticality_level (enum) - Assessment criticality level
- previousStageResults (object) - Results from Stage 1 interviews

**Output Fields:**
- All AssessmentResult fields (decision, score, consensus_assessment, strengths, concerns, recommendations, growth_potential, leadership_level, cultural_fit_level, team_integration_potential)
- final_decision (hire|declined|maybe)
- confidence (0-100)
- reasoning (array of { heading, summary })
- next_steps (array)

---

## CVOptimizationResult

**Common Schema** - Used by 2 agents:
- CV Optimizer
- cv_optimizer.v1.1.0

**Input Fields:**
- candidateCV (string) - Candidate CV/resume content
- jobDescription (string) - Job description and requirements
- name (string) - Candidate name
- email (string) - Candidate email
- company_name (string) - Company name
- role_applying_for (string) - Role being applied for
- criticality_level (enum) - Assessment criticality level
- previousStageResults (object) - Results from Stage 1 interviews

**Output Fields:**
- optimized_cv (object)
- changes_made (array)
- rationale (array of { heading, summary })
- ats_optimization (string)
- keyword_enhancements (array)

---

## FinalDecisionResult

**Common Schema** - Used by 3 agents:
- final_decision
- final_decision.v1.1.0
- final_decision.v1.2.0

**Input Fields:**
- candidateCV (string) - Candidate CV/resume content
- jobDescription (string) - Job description and requirements
- name (string) - Candidate name
- email (string) - Candidate email
- company_name (string) - Company name
- role_applying_for (string) - Role being applied for
- criticality_level (enum) - Assessment criticality level
- previousStageResults (object) - Results from Stage 2 analysis

**Output Fields:**
- final_decision (hire|declined|maybe)
- confidence (0-100)
- reasoning (array of { heading, summary })
- next_steps (array)

---

## CareerGuidanceResult

**Unique Schema** - Used by:
- Career Coach

**Input Fields:**
- candidateCV (string) - Candidate CV/resume content
- jobDescription (string) - Job description and requirements
- name (string) - Candidate name
- email (string) - Candidate email
- company_name (string) - Company name
- role_applying_for (string) - Role being applied for
- criticality_level (enum) - Assessment criticality level
- previousStageResults (object) - Results from Stage 1 interviews

**Output Fields:**
- career_advice (min 300 words)
- interview_feedback_summary (each key array of { heading, summary })

---

