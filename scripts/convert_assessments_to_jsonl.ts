import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TrainingExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

interface AssessmentResult {
  decision: string;
  score: number;
  narrative: string;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
  growth_potential: string;
  leadership_level: string;
  cultural_fit_level: string;
  team_integration_potential: string;
  interview_questions?: Array<{
    id: string;
    text: string;
    difficulty?: string;
    focus_area?: string;
  }>;
}

interface AgentResult {
  agentName: string;
  outputSchema: string;
  result: AssessmentResult | null;
}

interface RecruitmentResponse {
  candidate: {
    name: string;
    email: string;
    company_name: string;
    role_applying_for: string;
    criticality_level: string;
  };
  stages: Array<{
    stageName: string;
    agents: AgentResult[];
  }>;
}

/**
 * Converts assessment outputs to JSONL training format
 * Creates training examples from existing assessment results
 */
async function convertAssessmentsToJSONL() {
  const outputsDir = path.resolve(__dirname, '../../outputs');
  const outputDir = path.resolve(__dirname, '../prompts/fine-tuning');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Read all JSON files from outputs directory
  const files = fs.readdirSync(outputsDir)
    .filter(file => file.endsWith('.json'))
    .sort(); // Sort for consistent ordering

  const examples: TrainingExample[] = [];

  console.log(`📂 Found ${files.length} assessment files`);

  for (const file of files) {
    const filePath = path.join(outputsDir, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data: RecruitmentResponse = JSON.parse(content);

      // Process each agent result in each stage
      for (const stage of data.stages) {
        for (const agent of stage.agents) {
          if (!agent.result || agent.outputSchema !== 'assessment') {
            continue;
          }

          const assessment = agent.result as AssessmentResult;
          
          // Build system message with common prompts context
          // (In real training, you'd include the actual agent prompt here)
          const systemMessage = `You are a ${agent.agentName}. Your role is to assess candidates based on their CV and job requirements.

Key Requirements:
- Assess the candidate's CV against the job requirements
- Provide detailed, specific assessments with examples
- Use natural, conversational tone
- Follow the criticality level guidance
- Return valid JSON with all required fields

Criticality Level: ${data.candidate.criticality_level}`;

          // Build user message with CV and job requirements
          // Note: The actual CV and job description aren't in the output files
          // You'd need to match these with the original inputs
          const userMessage = `Candidate: ${data.candidate.name}
Role: ${data.candidate.role_applying_for}
Company: ${data.candidate.company_name}

Please assess this candidate for the role.`;

          // Build assistant message with the assessment result
          const assistantMessage = JSON.stringify(assessment, null, 2);

          examples.push({
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userMessage },
              { role: 'assistant', content: assistantMessage },
            ],
          });
        }
      }

      console.log(`✅ Processed: ${file}`);
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }

  // Write to JSONL file
  const outputPath = path.join(outputDir, 'assessment_training_data.jsonl');
  const jsonlContent = examples
    .map(example => JSON.stringify(example))
    .join('\n');

  fs.writeFileSync(outputPath, jsonlContent, 'utf-8');
  
  console.log(`\n✅ Created: ${outputPath}`);
  console.log(`📊 Total examples: ${examples.length}`);
  console.log(`\n⚠️  Note: These examples don't include the original CV/job description content.`);
  console.log(`   You'll need to match outputs with original inputs for complete training data.`);
}

// Run the conversion
convertAssessmentsToJSONL().catch(console.error);

