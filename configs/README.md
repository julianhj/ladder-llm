# Agent config: inputs and outputs

This directory contains [agents.json](agents.json), the single source for pipeline stage and agent definitions. Every agent declares **inputs** and **output** in a consistent way so you can see data flow from one agent/stage to another.

## Default model (`agents.json`)

- **`defaultModel`** (optional object): pipeline-wide defaults merged into every agent before the run.
  - **`name`** (required when `defaultModel` is present): model id (e.g. `gpt-5.2`).
  - **`temperature`** (optional): merged into `modelParams` when set.
  - **`max_tokens`** (optional): merged into `modelParams` when set.
- **Per-agent override:** set `modelParams.model`, `modelParams.temperature`, and/or `modelParams.max_tokens` on an agent; those fields replace the defaults from `defaultModel`.
- **Final fallback:** if an agent still has no `modelParams.model` after merge (e.g. `defaultModel` omitted), the runner uses `defaultModel.name` from [openai.json](openai.json).

## Preprocessing model (`agents.json`)

- **`preprocessing`** (optional object): shared settings for the **CV extractor** and **job description extractor** (not pipeline stages; code-owned agents).
  - **`name`** (required when `preprocessing` is present): OpenAI model id (e.g. `gpt-5.4-mini`).
  - **`temperature`** (optional): API temperature; if omitted, falls back to `preprocessingModel` / `defaultModel` in [openai.json](openai.json), then `0.2`.
  - **`max_tokens`** (optional): maps to `max_output_tokens` for those calls; if omitted, falls back to openai.json `preprocessingModel` / `defaultModel` `maxTokens`, then `8000`.
- **Precedence:** when `preprocessing.name` is non-empty after trim, **`agents.json` wins** for model, temperature, and max tokens (with per-field fallbacks as above). Otherwise behaviour is unchanged: **`openai.json`** `preprocessingModel` then `defaultModel` (same as before this block existed).

## Output

- **outputSchema**: Each agent has an `outputSchema` (schema name). The agent's result is validated against that schema. Output schemas are defined only in Zod (schema registry / StructuredInputs); JSON schema is generated at runtime and injected into the API. Prompt YAMLs must not define inline `output_schema`.
- **mergeOutputs**: For stages that merge agent results (Stage 1 Background, Stage 14 Consensus when using partial agents, Stage 15 Final Decision), the stage's `mergeOutputs` describes how combined output is built (e.g. `sourceAgents` and `output` field mapping).

## Inputs

Every agent has an `inputs` object. Keys are input names; values are **refs** that describe where the value comes from. The runner injects these for Stage 14; for earlier stages, injection is done in PipelineRunner (see code), and `inputs` here are **declarative** so the config is self-describing.

Ref formats:

| Ref | Meaning |
|-----|--------|
| `true` | From pipeline context (key name = context key, e.g. `structuredCV`, `consensus_feedback`). Injected by runner for Stage 9. |
| `{ "from": "agent_id" }` | From that agent's result (same stage or prior wave). Injected by runner when resolving Stage 9 inputs. |
| `{ "from": "input", "field": "path" }` | From candidate profile / pipeline input at path (e.g. `structuredCV.skills`). |
| `{ "from": "stage", "stageId": "stage_X" }` | Logical source is that stage's results. Runner resolves and injects. |
| `{ "from": "composite", "stageIds": ["stage_X", "stage_Y"] }` | Logical source is a composite of those stages. Runner resolves and injects (e.g. Stage 8, 10, 13). |

## Timeout (per agent)

- **timeout** (optional, number): Request timeout in **milliseconds** for this agent. Overrides the global default from `openai.json` (or 180_000 ms / 3 minutes). Use for agents that need longer runs (e.g. heavy reasoning or large outputs). Example: `"timeout": 300000` for 5 minutes. Omit to use the global default.

## Injected prompts (common fragments)

- **injectedPrompts** (optional, array of strings): List of common prompt fragment keys to inject into the agent's prompt object. This is the single source of truth for which shared instructions each agent receives; there is no per-handler logic that adds or omits fragments.

  Allowed keys: `json_output_format`, `output_verbosity_enforcement`, `seniority_alignment`, `llm_responsibilities`, `cv_optimization_level_guidance`. Each key corresponds to a YAML file under `prompts/common/`; the loader injects that content as the given key in the prompt object sent to the API.

  If omitted, no common fragments are injected. Typical agents use `["json_output_format", "output_verbosity_enforcement", "seniority_alignment", "llm_responsibilities"]`. Agents that should not receive verbosity guidance (e.g. signal normaliser, evidence synthesiser, interview calibration) omit `output_verbosity_enforcement`. The CV optimizer agent adds `cv_optimization_level_guidance`.

## Input context

- **excludeFullStructuredDocuments** (optional, boolean): When `true`, this agent does not receive the full `structuredCV` or `structuredJobDescription` documents. Pipeline-injected slices (e.g. `structuredJobDescription_role_title`, `structuredCV_skills`) from config `inputs` are still included. Reduces tokens and latency.
- **excludeFullStructuredCV** (optional, boolean): When `true`, this agent does not receive the full `structuredCV` document. Pipeline-injected slices (e.g. `structuredCV_skills`) from config `inputs` are still included. Use when the agent needs only JD or previous-stage results (e.g. Role Success Model).
- **excludeFullStructuredJD** (optional, boolean): When `true`, this agent does not receive the full `structuredJobDescription` document. Pipeline-injected slices (e.g. `structuredJobDescription_role_title`) from config `inputs` are still included. Use when the agent needs only CV or previous-stage results (e.g. Career Trajectory).

## Execution: parallel stage groups (single config)

**parallelStageGroups** (optional): array of stage-id arrays; **one config** controls both "run in parallel with pipeline" and "run as batch":

- **First element (index 0):** Stage ids that run in parallel with each other at pipeline start. The runner starts them all and **awaits all of them** before running the first main stage, so execution order is: preprocessor → first parallel group (e.g. Career Trajectory + Role Success Model) → first main stage (e.g. Background) → … . Each result is also injected before any later main stage that depends on it (via `inputs.previousStageResults`). Example: `[["stage_0_career_trajectory", "stage_2_role_success_model"]]` so career trajectory and role success model run in parallel, then background runs as the first main stage.
- **Remaining elements:** Batch groups. Each inner array is `[firstStageId, ...rest]`. When the runner reaches the first stage in a group, it runs all stages in that group in parallel, then continues. Example: `[["stage_7_evidence_traceability", "stage_8_panel_weighting"]]` runs Stage 7 and 8 in one batch.

Example: `[["stage_0_career_trajectory", "stage_2_role_success_model"], ["stage_7_evidence_traceability", "stage_8_panel_weighting"], ["stage_10_anomaly_detection", "stage_12_recruiter_reality_validator", "stage_13_seniority_signal_enforcement"]]`.

## Unstructured vs structured inputs

Pipeline inputs start as **unstructured** (raw CV text, raw job description text). Preprocessing (CV extractor, Job Description extractor) turns them into **structured** data (`structured_cv`, `structured_job_description`) used by all pipeline stages. In config and code, "structured CV" / "structured job description" refer to these preprocessor outputs.

## Stage 0 (Career Trajectory) and Stage 2 (Role Success Model)

The first parallel group is Stage 0 (Career Trajectory) and Stage 2 (Role Success Model) only; they run in parallel and are both awaited before Stage 3. Stage 0 agents receive pipeline context (structured CV, optional JD) from the runner. Stage 2 agents receive structured CV and structured job description fields from config `inputs` (no prior stage results); full CV and JD documents are excluded via `excludeFullStructuredCV` / `excludeFullStructuredDocuments` where configured.


## Where data comes from (by stage)

- **Stage 0** (Career Trajectory): No prior stage. Runner injects pipeline context (structured CV, JD).
- **Stage 2** (Role Success Model): No prior stage results; runner injects selected structured CV and JD slices via config `inputs`; full documents excluded via `excludeFullStructuredDocuments` / `excludeFullStructuredCV`.
- **Stage 3** (Interviews): Interview agents use structured CV and JD field slices from config `inputs` (see agents.json). Stage 3 starts after the first parallel group (Stages 0 and 2) completes.
- **Stage 4** (Signal Normalisation): `previousStageResults` = Stage 3 (interviews).
- **Stage 5** (Interview Calibration): `previousStageResults` = Stage 4 (signal_normalized).
- **Stage 6** (Evidence Synthesiser): `previousStageResults` = composite of Stage 2 + Stage 5 (role success model + calibrated_signals).
- **Stage 7** (Evidence Traceability): `previousStageResults` = Stage 6 (evidence_synthesiser).
- **Stage 8** (Panel Weighting): `previousStageResults` = composite of Stage 3 + Stage 6.
- **Stage 9** (Signal Confidence Aggregation): code-only; no LLM agents.
- **Stage 10** (Anomaly Detection): `previousStageResults` = Stage 8 (panel_weighting).
- **Stage 11** (Counterfactual Challenge): `previousStageResults` = composite of Stage 5, 6, 8, 9, 10.
- **Stage 12** (Recruiter Reality Validator): `previousStageResults` = composite of Stage 4 + Stage 6 (+ signal_layer from runner).
- **Stage 13** (Seniority Signal Enforcement): `previousStageResults` = Stage 6 (evidence_synthesiser).
- **Stage 14** (Consensus Decision): Consensus Decision Maker gets `compact_signal_summary`, `signal_layer`, and `previousStageResults` (composite of stages 0, 2, 4–13). Runner overlays score and final_decision from signal layer. (Alternative config: consensus partial agents + merge, then optional narrative_expander; runner builds these.)
- **Stage 15** (Final Decision): All inputs are resolved from config (`inputs` with `true`, `from: "agent_id"`, or `from: "input", field`). Runner resolves evidence_signals, seniority_signal_enforcement, recruiter_reality_output from stage 6, 12, 13.
