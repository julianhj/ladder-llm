# Prompts Directory Structure

Prompts are organised by **pipeline stage ID** to match `configs/agents.json`. Folder names use the form `stage_N_name` (e.g. `stage_0_career_trajectory` through `stage_15_final_decision`). See `AGENT_PIPELINE_DIAGRAM.md` for the conceptual flow.

Authoring standards that apply to all prompts in this directory: **`prompt_authoring_standards.md`**. See also `VERSIONING.md` for versioning rules. **Operational prompts** are only those whose `promptBase` + `version` appear in `configs/agents.json`; superseded semver files may be moved to **`old/`** (see `old/README.md`). Wording: **`docs/PROMPT_LANGUAGE.md`** (avoid assessment jargon that models echo into CVs).

## Stage folders (prompt directories)

Folder names match the stage IDs in `configs/agents.json`. Paths are relative to `packages/openai/prompts/`.

| Stage ID | Folder | Contents |
|----------|--------|----------|
| (pre-pipeline) | **preprocessing/** | CV extractor, Job Description extractor. Consume unstructured CV and unstructured job description (raw text); produce structured_cv and structured_job_description. |
| stage_0 | **stage_0_career_trajectory/** | Career Trajectory Analysis. |
| stage_2 | **stage_2_role_success_model/** | Role Success Model. |
| stage_3 | **stage_3_interviews/** | Technical, Soft Skills, Leadership, Recruiter, Hiring Manager. Parallel assessment signals. |
| stage_4 | **stage_4_signal_normalisation/** | Signal Normaliser. Normalise interviewer outputs. |
| stage_5 | **stage_5_interview_calibration/** | Interview Calibration. |
| stage_6 | **stage_6_evidence_synthesiser/** | Evidence Synthesiser. Convert normalised signals to evidence. |
| stage_7 | **stage_7_evidence_traceability/** | Evidence Traceability. |
| stage_8 | **stage_8_panel_weighting/** | Panel Weighting. Weight evidence. |
| stage_9 | (code-only) | Signal confidence aggregation; no prompt folder. |
| stage_10 | **stage_10_anomaly_detection/** | Anomaly Detector. |
| stage_11 | **stage_11_counterfactual_challenge/** | Counterfactual Challenge. |
| stage_12 | **stage_12_recruiter_reality_validator/** | Recruiter Reality Validator. |
| stage_13 | **stage_13_seniority_signal_enforcement/** | Seniority Signal Enforcement. |
| stage_14 | **stage_14_consensus_decision/** | Consensus partial agents (agent_alignment_overview, agent_key_strengths, agent_risk_areas, agent_hiring_recommendation, agent_scores, agent_reasoning) and Narrative Expander. |
| stage_15 | **stage_15_final_decision/** | Final Decision & CV Optimization (evidence_integration, seniority_reality_enforcer, skill_formatter, experience_formatter, section_rewriter, role_fit_ats). |
| — | **common/** | Output format, narrative style, writing guidelines (injectable fragment), verbosity/criticality/audience guidance, scoring rubric, etc. Injected by AgentBuilder where applicable. |
| — | **configs/** | `agents.json` (stage and agent definitions, promptBase paths, versions), `openai.json`. |
| — | **fine-tuning/** | JSONL and schema docs for fine-tuning. |
| — | **generator/** | Training data generation scripts. |

## Prompt path (promptBase)

Each agent in `configs/agents.json` has a `promptBase` of the form `stage_N_name/agent_file` (no version in the path; version is in the filename). Examples:

- `stage_0_career_trajectory/career_trajectory_analysis`
- `stage_3_interviews/technical_interviewer`
- `stage_4_signal_normalisation/signal_normaliser`
- `stage_14_consensus_decision/agent_alignment_overview`
- `stage_15_final_decision/evidence_integration`

The loader resolves the file as `{promptBase}.v{version}.yaml` under `packages/openai/prompts/`. Each prompt file is YAML with optional top-level `version`, `lastModified`, `description`, and required `prompt`.

**Required: structured prompt.** The `prompt` field must be an object (not a raw string). The loader renders this object to a single string for the model. Use these keys where they apply: `role`, `objective` (multiline with `>`), `rules` (list of strings), `output_requirements` (`format` and `constraints`), `final_instruction`. Optional: `inputs` as an **author-defined** map in YAML only if you want an “Inputs” section in the rendered text; **AgentBuilder does not** append key descriptions from `configs/agents.json` into `promptObject.inputs` (those `inputs` only define the separate API user payload). Do not define inline `output_schema` in prompt YAMLs; output schemas are defined in Zod (schema registry) and injected as JSON schema at runtime. You can add other section keys (e.g. `research_standards`, `instructions`, `golden_rule`); the renderer outputs any key as a section. Do not use `prompt: |` with a blob of plain text. Reference: `stage_15_final_decision/evidence_integration.v1.0.0.yaml`. See `VERSIONING.md` for versioning rules. A Cursor rule (`.cursor/rules/prompts-structured-yaml.mdc`) enforces this format when editing prompt YAML files.

## Audit

Audit & Compliance (stage_10_audit_logging) is implemented in code (`src/logic/stage_10_audit_logging/auditLog.ts`), not as a prompt folder.
