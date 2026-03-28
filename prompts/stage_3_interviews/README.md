# Stage 3 – Interviewer prompts

## Consistency rule

**All interviewer prompt YAMLs in this folder must be identical except for:**

- `version`
- `lastModified`
- `description`
- `prompt.role`
- `prompt.objective`

So `prompt.rules` and `prompt.output_requirements` (and any other prompt keys) must be the same in every file. Do not add or change rules or output_requirements for only one interviewer.

## Injected data (keep consistent in config)

Prompt content is not only what’s in the YAML. The pipeline also injects:

1. **User message payload** – Values for each key in `configs/agents.json` → `inputs` are passed to the model as structured JSON in the API **input** (not as a glossary inside `instructions`). The same keys, `field` paths, and `description` metadata must be defined for every stage_3 interviewer so each interviewer receives the same slices of CV and JD data.
2. **Common fragments** – Loaded once and applied by the assessment handler for all assessment agents (all interviewers): seniority alignment, output verbosity enforcement, JSON output format, schema description, LLM responsibilities.  
   - See: `promptLoader.loadCommonPromptFragments`, `stage_3_interviews/handler.ts` (assessmentHandler.buildPrompt).

So in **agents.json**, every stage_3 interviewer must have the same `inputs` object (same keys, same `field` and `description`). Do not add or remove inputs for only one interviewer, and do not set `promptInstructions` on only some of them.

## Checklist when changing interviewer prompts

- [ ] Change is only in `version`, `lastModified`, `description`, `prompt.role`, or `prompt.objective` in the **one** file for that interviewer.
- [ ] If you need to change `rules` or `output_requirements`, update **all five** YAML files to the same text.
- [ ] If you need to change which inputs an interviewer receives, update **all five** agents in `configs/agents.json` so their `inputs` stay in sync.
