import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AssessmentResultSchema,
  CVOptimizationResultSchema,
  CareerGuidanceResultSchema,
  FinalDecisionResultSchema,
} from '../src/agents/AgentBuilder';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TrainingExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

interface JSONLExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Creates fine-tuning training data that includes Zod schemas
 * Combines prompts from common_prompts.jsonl and interviewer_prompts.jsonl
 * with JSON Schema definitions for each output schema type
 */
async function createSchemaTrainingData() {
  const promptsDir = path.resolve(__dirname, '../prompts/fine-tuning');
  const outputDir = path.resolve(__dirname, '../prompts/fine-tuning');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Schema definitions mapping
  const schemas = {
    AssessmentResult: {
      schema: AssessmentResultSchema,
      name: 'AssessmentResult',
      description: 'Assessment result for candidate evaluation',
    },
    CVOptimizationResult: {
      schema: CVOptimizationResultSchema,
      name: 'CVOptimizationResult',
      description: 'CV optimization recommendations and changes',
    },
    CareerGuidanceResult: {
      schema: CareerGuidanceResultSchema,
      name: 'CareerGuidanceResult',
      description: 'Career guidance and development recommendations',
    },
    FinalDecisionResult: {
      schema: FinalDecisionResultSchema,
      name: 'FinalDecisionResult',
      description: 'Final hiring decision with confidence and reasoning',
    },
  };

  // Convert Zod schemas to JSON Schema
  const jsonSchemas: Record<string, any> = {};
  for (const [key, { schema, name }] of Object.entries(schemas)) {
    try {
      jsonSchemas[key] = zodToJsonSchema(schema, {
        name,
        target: 'openApi3',
      });
      console.log(`✅ Converted ${name} schema to JSON Schema`);
    } catch (error) {
      console.error(`❌ Error converting ${name} schema:`, error);
    }
  }

  // Load existing prompt files
  const commonPromptsPath = path.join(promptsDir, 'common_prompts.jsonl');
  const interviewerPromptsPath = path.join(promptsDir, 'interviewer_prompts.jsonl');

  const examples: TrainingExample[] = [];

  // Process common prompts
  if (fs.existsSync(commonPromptsPath)) {
    console.log(`\n📖 Reading ${path.basename(commonPromptsPath)}`);
    const content = fs.readFileSync(commonPromptsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    let processedCount = 0;
    for (const line of lines) {
      try {
        const example: JSONLExample = JSON.parse(line);
        
        // For each schema type, create a training example
        for (const [schemaKey, { name, description }] of Object.entries(schemas)) {
          const jsonSchema = jsonSchemas[schemaKey];
          
          if (!jsonSchema) {
            console.warn(`⚠️  JSON Schema not available for ${name}, skipping`);
            continue;
          }
          
          // Create system message with prompt + schema
          const systemMessage = `${example.messages[0]?.content || ''}

## Output Schema Requirements

You must output responses that match the following JSON schema exactly (${name}):

\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`

**Schema Description**: ${description}

**Important**: 
- All responses must be valid JSON that matches this schema
- String fields with minimum length requirements must meet those requirements
- Array fields with length requirements must have exactly that many items
- Enum fields must use one of the specified values
- Number fields must be within the specified min/max ranges`;

          examples.push({
            messages: [
              {
                role: 'system',
                content: systemMessage,
              },
            ],
          });
          processedCount++;
        }
      } catch (error) {
        console.error(`❌ Error parsing line:`, error);
      }
    }
    console.log(`✅ Processed ${lines.length} prompt examples, created ${processedCount} training examples`);
  } else {
    console.warn(`⚠️  File not found: ${commonPromptsPath}`);
  }

  // Process interviewer prompts
  if (fs.existsSync(interviewerPromptsPath)) {
    console.log(`\n📖 Reading ${path.basename(interviewerPromptsPath)}`);
    const content = fs.readFileSync(interviewerPromptsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    let processedCount = 0;
    for (const line of lines) {
      try {
        const example: JSONLExample = JSON.parse(line);
        
        // Interviewer prompts typically use AssessmentResult schema
        const jsonSchema = jsonSchemas.AssessmentResult;
        const { name, description } = schemas.AssessmentResult;
        
        if (!jsonSchema) {
          console.warn(`⚠️  JSON Schema not available for ${name}, skipping`);
          continue;
        }
        
        const systemMessage = `${example.messages[0]?.content || ''}

## Output Schema Requirements

You must output responses that match the following JSON schema exactly (${name}):

\`\`\`json
${JSON.stringify(jsonSchema, null, 2)}
\`\`\`

**Schema Description**: ${description}

**Important**: 
- All responses must be valid JSON that matches this schema
- String fields with minimum length requirements must meet those requirements
- Array fields with length requirements must have exactly that many items
- Enum fields must use one of the specified values
- Number fields must be within the specified min/max ranges`;

        examples.push({
          messages: [
            {
              role: 'system',
              content: systemMessage,
            },
          ],
        });
        processedCount++;
      } catch (error) {
        console.error(`❌ Error parsing line:`, error);
      }
    }
    console.log(`✅ Processed ${lines.length} prompt examples, created ${processedCount} training examples`);
  } else {
    console.warn(`⚠️  File not found: ${interviewerPromptsPath}`);
  }

  // Write to JSONL file
  const outputPath = path.join(outputDir, 'schema_training_data.jsonl');
  const jsonlContent = examples
    .map(example => JSON.stringify(example))
    .join('\n');

  fs.writeFileSync(outputPath, jsonlContent, 'utf-8');
  
  console.log(`\n✅ Created: ${outputPath}`);
  console.log(`📊 Total examples: ${examples.length}`);
  console.log(`\n💡 This file includes prompts with Zod schema definitions for fine-tuning.`);
  console.log(`   Each example includes the prompt text plus the JSON Schema definition.`);
}

// Run the conversion
createSchemaTrainingData().catch(console.error);

