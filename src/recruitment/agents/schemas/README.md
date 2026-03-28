# Agent output schemas

Zod schemas for pipeline agent outputs. JSON Schema is generated from these at request time (e.g. via `zod-to-json-schema`) when calling the LLM API.

## Layout

- **common.ts** – Shared primitives and types: `Score0To100Schema`, `DecisionEnumSchema`, `StringArraySchema`, `SkillRepresentationModeSchema`, signal dimension constants (`SIGNAL_AGGREGATED_KEYS`, `SIGNAL_BLOCKS_KEYS`), `SignalCategoryScoresSchema`, `SignalCategoryArraysSchema`, plus assessment/consensus building blocks and `CandidateProfileSchema`.
- **stage_N_*.ts** – Per-stage output schemas. Each stage file defines only the schemas used by that stage’s agents.
- **index.ts** – Barrel: re-exports all schemas and types so the rest of the codebase imports from `./schemas/index.js`.

## Signal dimension conventions

The same five conceptual dimensions (scope/technical, execution, leadership, business, risk/delivery) appear under **two naming conventions**. API and pipeline logic depend on these exact property names; do not change them without coordinated updates in schemas, `stage_14_consensus_decision/signalBlocks.ts`, `listFields.ts`, and any consumers.

| Convention        | Keys (property names)                                                                 | Where used |
|-------------------|---------------------------------------------------------------------------------------|------------|
| **Aggregated**    | `technical_scope`, `execution_authority`, `leadership_impact`, `delivery_risk`, `business_alignment` | stage_4 (signal_normalized), stage_5 (calibrated_scores), listFields normalizer, signalBlocks (source) |
| **Signal blocks** | `technical_depth`, `execution_maturity`, `leadership_scope`, `delivery_risk`, `business_alignment`  | common (assessment/consensus `signal_blocks`), signalBlocks (target) |

- **SIGNAL_AGGREGATED_KEYS** – Use when building or normalising `aggregated_signals` (stage_4) or the five-category score/array objects used by stage_4 and stage_5.
- **SIGNAL_BLOCKS_KEYS** – Use for assessment/consensus `signal_blocks` (same five dimensions, different names). The pipeline maps aggregated → blocks in `stage_14_consensus_decision/signalBlocks.ts`.

Stage 6 (evidence_synthesiser) uses a different set of keys: `scope_signals`, `execution_signals`, `leadership_signals`, `business_signals`, `risk_signals`. Stage 8 (panel_weighting) uses `technical`, `leadership`, `execution`, `culture`. Those are left as-is.

## Shared primitives

- **Score0To100Schema** – Single score or confidence in 0–100 range.
- **DecisionEnumSchema** – `'hire' | 'declined' | 'maybe'` for decision/final_decision.
- **StringArraySchema** – `z.array(z.string()).default([])` for optional or default-empty string arrays.
- **SkillRepresentationModeSchema** – `'keywords' | 'narrative'` for CV/seniority outputs.

Use these instead of inline equivalents so behaviour and constraints stay consistent.

## Adding or changing schemas

1. Add or extend schemas in the appropriate file (common for shared types, or the stage file for that agent).
2. Register in `schemaRegistry.ts`: add to `OutputSchemaName` and `schemaMap`.
3. Re-export from `index.ts` if the schema or type is used outside the stage.
4. Use shared primitives and signal dimension constants where applicable so changes stay in one place.
