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

/**
 * Combines common_prompts.jsonl and interviewer_prompts.jsonl into prompts.jsonl
 */
async function combinePromptsJSONL() {
  const outputDir = path.resolve(__dirname, '../prompts/fine-tuning');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const commonPromptsPath = path.join(outputDir, 'common_prompts.jsonl');
  const interviewerPromptsPath = path.join(outputDir, 'interviewer_prompts.jsonl');
  const outputPath = path.join(outputDir, 'prompts.jsonl');

  const examples: TrainingExample[] = [];

  // Read common_prompts.jsonl
  console.log(`📖 Reading: ${commonPromptsPath}`);
  console.log(`   Full path: ${path.resolve(commonPromptsPath)}`);
  if (fs.existsSync(commonPromptsPath)) {
    const content = fs.readFileSync(commonPromptsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    console.log(`   Found ${lines.length} lines`);
    
    // Show first example for verification
    if (lines.length > 0) {
      try {
        const firstExample = JSON.parse(lines[0]);
        const firstContent = firstExample.messages?.[0]?.content || '';
        console.log(`   First example preview (first 150 chars): ${firstContent.substring(0, 150)}...`);
      } catch (e) {
        // ignore
      }
    }
    
    for (const line of lines) {
      try {
        const example: TrainingExample = JSON.parse(line);
        examples.push(example);
      } catch (error) {
        console.error(`❌ Error parsing line in common_prompts.jsonl:`, error);
        console.error(`   Line content (first 100 chars): ${line.substring(0, 100)}`);
      }
    }
    console.log(`✅ Added ${examples.length} examples from common_prompts.jsonl`);
  } else {
    console.error(`❌ File not found: ${commonPromptsPath}`);
    console.error(`   Resolved path: ${path.resolve(commonPromptsPath)}`);
    process.exit(1);
  }

  const commonCount = examples.length;

  // Read interviewer_prompts.jsonl
  console.log(`\n📖 Reading: ${interviewerPromptsPath}`);
  console.log(`   Full path: ${path.resolve(interviewerPromptsPath)}`);
  if (fs.existsSync(interviewerPromptsPath)) {
    const content = fs.readFileSync(interviewerPromptsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    console.log(`   Found ${lines.length} lines`);
    
    // Show first example for verification
    if (lines.length > 0) {
      try {
        const firstExample = JSON.parse(lines[0]);
        const firstContent = firstExample.messages?.[0]?.content || '';
        console.log(`   First example preview (first 150 chars): ${firstContent.substring(0, 150)}...`);
      } catch (e) {
        // ignore
      }
    }
    
    for (const line of lines) {
      try {
        const example: TrainingExample = JSON.parse(line);
        examples.push(example);
      } catch (error) {
        console.error(`❌ Error parsing line in interviewer_prompts.jsonl:`, error);
        console.error(`   Line content (first 100 chars): ${line.substring(0, 100)}`);
      }
    }
    console.log(`✅ Added ${examples.length - commonCount} examples from interviewer_prompts.jsonl`);
  } else {
    console.error(`❌ File not found: ${interviewerPromptsPath}`);
    console.error(`   Resolved path: ${path.resolve(interviewerPromptsPath)}`);
    process.exit(1);
  }

  // Write combined prompts.jsonl
  console.log(`\n📝 Writing combined file: ${outputPath}`);
  console.log(`   Full path: ${path.resolve(outputPath)}`);
  
  const jsonlContent = examples
    .map(example => JSON.stringify(example))
    .join('\n');

  fs.writeFileSync(outputPath, jsonlContent, 'utf-8');
  
  console.log(`\n✅ Created: ${outputPath}`);
  console.log(`📊 Total examples: ${examples.length} (${commonCount} from common, ${examples.length - commonCount} from interviewers)`);
  console.log(`\n💡 prompts.jsonl now contains all prompts from common_prompts.jsonl and interviewer_prompts.jsonl`);
}

// Run the combination
combinePromptsJSONL().catch(console.error);

