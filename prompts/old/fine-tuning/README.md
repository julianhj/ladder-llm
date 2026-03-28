# Fine-Tuning Data

This directory contains JSONL format files for OpenAI fine-tuning.

## Files

- `prompts.jsonl` - Prompts from `common`, `background`, `evidence`, `calibration`, and `decision` folders converted to system messages
- `interviewer_prompts.jsonl` - Interviewer prompts from `interviewers` folder converted to system messages
- `assessment_training_data.jsonl` - Assessment outputs converted to training examples
- `combined_system_prompt.txt` - Combined system prompt for reference
- `output_schemas.md` - Extracted input/output schemas for all agent types

## Usage

### Generate Prompts JSONL (common, background, evidence, calibration, decision)
```bash
cd packages/openai
npm run convert-prompts
```

This processes all `.md` files from:
- `prompts/common/`
- `prompts/background/`
- `prompts/evidence/`
- `prompts/calibration/`
- `prompts/decision/`

### Generate Interviewer Prompts JSONL
```bash
npm run extract-interviewers
```

This processes all `.md` files from:
- `prompts/interviewers/` (6 files: technical, soft_skills, leadership, recruiter, hiring_manager)

### Generate Assessment Training Data
```bash
npm run convert-assessments
```

### Create Combined System Prompt
```bash
npm run create-training-data
```

### Extract Output Schemas
```bash
npm run extract-schemas
```

Generates `output_schemas.md` with input/output field definitions for all schemas.

## Creating Complete Training Data

For complete training data, you need to:

1. **Match outputs with inputs**: Link each assessment output to its original CV and job description
2. **Include agent prompts**: Add the specific agent prompt (e.g., technical_interviewer.md) to the system message
3. **Structure properly**: 
   - System: Agent prompt + common prompts
   - User: CV content + job description + candidate info
   - Assistant: Assessment result (JSON)

## Fine-Tuning Process

1. Prepare your JSONL files
2. Validate format: `openai tools fine_tunes.prepare_data -f <file>.jsonl`
3. Create fine-tune: `openai api fine_tunes.create -t <file>.jsonl -m <base_model>`
4. Monitor: `openai api fine_tunes.follow -i <fine_tune_id>`

## Cost Considerations

- Training: $8-80 per 1M tokens (one-time)
- Inference: Typically cheaper per token than base models
- Break-even: Usually requires 1000+ API calls per month

## Notes

- Current scripts generate partial training data
- Complete training data requires matching outputs with original inputs
- Consider data quality and diversity when selecting training examples
- The common prompts remain unchanged in `prompts/common/`

