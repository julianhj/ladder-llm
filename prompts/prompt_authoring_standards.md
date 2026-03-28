# Prompt Authoring and Formatting Standards - vNext

## Overview

These standards govern how all prompts are written, structured, versioned, and maintained.

They apply to:

- Stage A research prompts
- Stage B deterministic formatter prompts
- Audit-related prompts
- Any LLM interaction in the pipeline

All prompts must support:

- Deterministic formatting
- YAML structure
- Schema validation
- Enterprise audit traceability
- Backward compatibility with UI layers

**Assessment jargon:** Avoid wording that models echo into candidate-visible CV text. See [`docs/PROMPT_LANGUAGE.md`](../docs/PROMPT_LANGUAGE.md).

---

# 1. Prompt Architecture Model

All prompts must follow the dual-stage architecture.

## Stage A - Research and Reasoning

### Purpose

- Perform analysis
- Generate structured findings
- Extract signals
- Evaluate evidence

### Characteristics

- May use reasoning internally
- Must output structured JSON only
- No UI formatting concerns
- No narrative presentation styling
- No audit metadata generation

## Stage B - Deterministic Formatter

### Purpose

- Transform structured Stage A output into final schema format
- Enforce formatting constraints
- Apply writing guidelines
- Ensure schema compliance

### Characteristics

- No new reasoning
- No new facts
- No reinterpretation
- Only transformation of provided inputs
- Strict schema enforcement

Stage B must never introduce new claims.

---

# 2. YAML-First Prompt Structure

All prompts must be written in YAML format.

## Prompt file format (loader)

Every prompt file under `prompts/` must use **structured YAML**: the `prompt` field must be an **object**, not a raw string. Do not use `prompt: |` with a free-form text blob. The loader (`parsePromptYaml` / `renderStructuredPrompt` in `src/utils/PromptVersion.ts`) renders this object to a single string for the model.

**Top-level:** `version`, optional `lastModified`, optional `description`, and required `prompt` (object).

**Under `prompt`**, use these keys where they apply:

- `role` (string): Agent role.
- `objective` (string): Multiline with `>`; main task or goal.
- `inputs` (map, optional): Author-defined `input_name: "description"` only when you want an “Inputs” section in the rendered prompt. Pipeline agents: **`configs/agents.json` `inputs` are not auto-merged here**; they only control the separate API user message payload. Do not duplicate agents.json-injected keys solely to list them (see `.cursor/rules/prompts-injected-inputs-no-duplicate.mdc`).
- `rules` (list of strings): Behavioral or constraint rules.
- `output_requirements` (object): `format: "JSON only"` and `constraints: ["...", "..."]`.
- `output_schema` (object): `type: "object"` and `fields: { fieldName: "type description" }`.
- `final_instruction` (string): e.g. "No other text before or after the JSON."

You can add other section keys (e.g. `research_standards`, `instructions`, `golden_rule`); the renderer outputs any key as a section. Reference file: `stage_15_final_decision/evidence_integration.v1.0.0.yaml`. See `README.md` and `.cursor/rules/prompts-structured-yaml.mdc`.

## Required Structure (conceptual)

When authoring, each prompt should clearly specify: **role** (who the agent is), **objective** (what it must do), **rules** (behavioral and output constraints), **output_requirements** (e.g. JSON only, no padding), and **output_schema** (field names and types) where used. Optional YAML **inputs** is for author-written sections only; actual injected data is defined in `agents.json`. Use the YAML keys under `prompt` so the loader can render them consistently. Avoid compound directives; use one rule per list item.

---

# 3. JSON Output Schema (Hard Rule)

**Any prompt that requires JSON output MUST describe that output using a formal JSON schema.**

- Do not rely on prose alone (e.g. "Return an object with heading and summary").
- Provide a valid JSON schema: either inline in the prompt, in a referenced schema file (e.g. under `schemas/`), or via the pipeline's schema injection (e.g. `getSchemaDescription` / schema registry).
- The schema MUST define `type`, `properties`, and `required` (where applicable). Use `additionalProperties: false` when the output must be closed.
- The model MUST receive the exact schema (or its full text) so that the API and prompt agree on the allowed shape.
- **Schema name:** When using pipeline or preprocessing schema injection, the prompt MUST name the schema in output format (e.g. `output_requirements.format: "JSON only matching the provided schema (schema_name)."`). Use the registry name (e.g. `optimized_structured_cv`, `structured_job_description`, `career_trajectory_profile`).

Prompts that output JSON without a corresponding JSON schema do not meet the authoring standard.

---

# 5. Writing and Formatting Standards (Stage B Only)

## Paragraphing

- 3 to 4 sentences maximum per paragraph
- One topic per paragraph
- Paragraph break between topic transitions
- No abrupt topic shifts

## Lists

Use lists only when:

- Enumerating strengths
- Enumerating concerns
- Enumerating action steps

List rules:

- Bullet points for unordered items
- Numbered lists for sequences
- No paragraphs inside list items
- Parallel structure across items
- Concise and actionable phrasing

## Language

- Clear and direct
- Avoid unnecessary jargon
- Explain acronyms on first use
- Prefer full terms over abbreviations
- No unexplained domain shorthand

## Tone

- Professional
- Neutral
- Evidence-based
- No exaggerated praise
- No dramatic language

---

# 6. Formatting Restrictions

Strict formatting rules:

- Never use em dash
- Never use en dash
- Use standard hyphen only
- No markdown unless explicitly required
- No code blocks in production output
- No commentary outside schema
- No trailing explanations
- All responses must be raw JSON when required.

---

# 7. Versioning Standards

Every prompt must include:

- `id: "unique_id"`
- `version: "major.minor.patch"`

## Version Increments

- **Major** - structural schema change
- **Minor** - instruction logic change
- **Patch** - wording clarification only

Prompt versions must align with audit `prompt_versions` tracking. Never modify a prompt silently without version bump.

---

# 8. Backward Compatibility Rules

When modifying prompts:

- Do not remove fields consumed by UI
- Do not rename fields without migration plan
- Do not change enum values without updating downstream consumers
- Add new fields as optional first
- Deprecate before removal

If a field is deprecated:

- Mark in comments
- Maintain for at least one pipeline version

---

# 9. Machine vs UI Separation

Prompts must clearly distinguish between machine and UI responsibilities.

## Machine Layer Outputs

- Structured
- Minimal
- Deterministic
- Evidence-bound

## UI Layer Outputs

- Narrative allowed
- Paragraph rules apply
- Formatting rules apply
- Readability optimized

Never mix the two responsibilities in a single prompt.

---

# 10. Prompt Quality Checklist

Before finalizing any prompt:

- [ ] YAML structure valid
- [ ] Version defined
- [ ] Stage defined
- [ ] Purpose defined
- [ ] Inputs clearly declared
- [ ] Instructions atomic and testable
- [ ] Constraints explicit
- [ ] Output schema complete (JSON output described by a formal JSON schema; see §3)
- [ ] No creative language
- [ ] Determinism enforced
- [ ] No audit metadata generated
- [ ] Backward compatibility preserved

---

# 11. Anti-Patterns to Avoid

Do not:

- Combine reasoning and formatting in one stage
- Let formatter reinterpret analysis
- Allow prompts to generate compliance metadata
- Use subjective adjectives without criteria
- Allow unlimited list growth
- Depend on LLM to maintain field naming consistency

---

# 12. Enterprise Readiness Standard

All prompts must support:

- Replayability
- Version traceability
- Schema validation
- Non-breaking upgrades
- Governance audits
- Deterministic output stability

If a prompt change would:

- Alter audit meaning
- Change score distribution
- Change decision thresholds
- Modify schema shape

It must be treated as a major version change.
