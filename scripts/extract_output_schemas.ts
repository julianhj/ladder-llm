import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SchemaInfo {
  schemaName: string;
  usedBy: string[];
  description: string;
  inputFields: string[];
  outputFields: string[];
}

/**
 * Extracts output schemas from all prompts and groups them
 * Shows common schemas only once
 */
async function extractOutputSchemas() {
  const promptsBaseDir = path.resolve(__dirname, '../prompts');
  const outputDir = path.resolve(__dirname, '../prompts/fine-tuning');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Map of schema name to info
  const schemas = new Map<string, SchemaInfo>();

  // Directories to process
  const directoriesToProcess = [
    'common',
    'analysis',
    'final_decision',
  ];

  // Process each directory
  for (const dir of directoriesToProcess) {
    const promptsDir = path.join(promptsBaseDir, dir);
    
    if (!fs.existsSync(promptsDir)) {
      console.warn(`⚠️  Directory not found: ${promptsDir}`);
      continue;
    }

    // Get all .md files in the directory
    const files = fs.readdirSync(promptsDir)
      .filter(file => file.endsWith('.md'))
      .sort();

    console.log(`\n📁 Processing directory: ${dir}`);

    // Read each prompt file and extract schema information
    for (const file of files) {
      const filePath = path.join(promptsDir, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Extract schema name from content - look for patterns like "matching the **AssessmentResult** schema"
        const schemaPattern = /matching the \*\*(\w+Result)\*\* schema/gi;
        const schemaMatches = content.match(schemaPattern);
        
        if (schemaMatches) {
          for (const match of schemaMatches) {
            const schemaMatch = match.match(/\*\*(\w+Result)\*\*/);
            if (schemaMatch) {
              const schemaName = schemaMatch[1];
              const agentName = file.replace('.md', '').replace('.v1.0.0', '');
              
              if (!schemas.has(schemaName)) {
                schemas.set(schemaName, {
                  schemaName,
                  usedBy: [],
                  description: '',
                  inputFields: [],
                  outputFields: [],
                });
              }
              
              const schemaInfo = schemas.get(schemaName)!;
              if (!schemaInfo.usedBy.includes(agentName)) {
                schemaInfo.usedBy.push(agentName);
              }
              
              // Try to extract field information from the same section
              const lines = content.split('\n');
              const schemaLineIndex = lines.findIndex(line => line.includes(match));
              if (schemaLineIndex >= 0) {
                // Look for "The schema includes:" in nearby lines
                for (let i = schemaLineIndex; i < Math.min(schemaLineIndex + 5, lines.length); i++) {
                  if (lines[i].includes('The schema includes:')) {
                    const fieldsStr = lines[i].replace('The schema includes:', '').trim();
                    // Clean up field extraction - remove quotes, parentheses, and split properly
                    const fields = fieldsStr
                      .split(',')
                      .map(f => f.trim())
                      .map(f => f.replace(/^["']|["']$/g, '')) // Remove surrounding quotes
                      .map(f => f.replace(/\([^)]*\)/g, '')) // Remove parenthetical notes
                      .map(f => f.trim())
                      .filter(f => f.length > 0);
                    if (fields.length > 0) {
                      schemaInfo.outputFields = fields;
                    }
                    break;
                  }
                }
              }
            }
          }
        }
        
        console.log(`  ✅ Processed: ${file}`);
      } catch (error) {
        console.error(`  ❌ Error processing ${file}:`, error);
      }
    }
  }

  // Also check agents.json for schema mappings and get proper agent names
  const agentsConfigPath = path.join(promptsBaseDir, 'configs', 'agents.json');
  const agentNameMap = new Map<string, string>(); // file name -> agent name
  
  if (fs.existsSync(agentsConfigPath)) {
    const agentsConfig = JSON.parse(fs.readFileSync(agentsConfigPath, 'utf-8'));
    
    for (const stage of agentsConfig.stages || []) {
      for (const agent of stage.agents || []) {
        const schemaName = mapOutputSchemaToResult(agent.outputSchema);
        if (schemaName) {
          if (!schemas.has(schemaName)) {
            schemas.set(schemaName, {
              schemaName,
              usedBy: [],
              description: '',
              inputFields: [],
              outputFields: [],
            });
          }
          
          const schemaInfo = schemas.get(schemaName)!;
          if (!schemaInfo.usedBy.includes(agent.name)) {
            schemaInfo.usedBy.push(agent.name);
          }
          
          // Map prompt file names to agent names
          const promptBase = agent.promptBase.split('/').pop() || '';
          agentNameMap.set(promptBase, agent.name);
          agentNameMap.set(`${promptBase}.v1.0.0`, agent.name);
        }
      }
    }
  }
  
  // Replace file names with agent names where possible
  for (const schema of schemas.values()) {
    schema.usedBy = schema.usedBy.map(name => {
      // If it's a file name, try to get the agent name
      const agentName = agentNameMap.get(name) || agentNameMap.get(`${name}.v1.0.0`);
      return agentName || name;
    });
    
    // Remove duplicates
    schema.usedBy = [...new Set(schema.usedBy)];
  }

  // Add input fields based on agent configuration
  const inputFieldsBySchema: Record<string, string[]> = {
    'AssessmentResult': [
      'candidateCV (string) - Candidate CV/resume content',
      'jobDescription (string) - Job description and requirements',
      'name (string) - Candidate name',
      'email (string) - Candidate email',
      'company_name (string) - Company name',
      'role_applying_for (string) - Role being applied for',
      'criticality_level (enum) - Assessment criticality level',
      'previousStageResults (object, optional) - Results from previous stage (for Consensus Decision Maker)',
    ],
    'CareerGuidanceResult': [
      'candidateCV (string) - Candidate CV/resume content',
      'jobDescription (string) - Job description and requirements',
      'name (string) - Candidate name',
      'email (string) - Candidate email',
      'company_name (string) - Company name',
      'role_applying_for (string) - Role being applied for',
      'criticality_level (enum) - Assessment criticality level',
      'previousStageResults (object) - Results from Stage 1 interviews',
    ],
    'CVOptimizationResult': [
      'candidateCV (string) - Candidate CV/resume content',
      'jobDescription (string) - Job description and requirements',
      'name (string) - Candidate name',
      'email (string) - Candidate email',
      'company_name (string) - Company name',
      'role_applying_for (string) - Role being applied for',
      'criticality_level (enum) - Assessment criticality level',
      'previousStageResults (object) - Results from Stage 1 interviews',
    ],
    'FinalDecisionResult': [
      'candidateCV (string) - Candidate CV/resume content',
      'jobDescription (string) - Job description and requirements',
      'name (string) - Candidate name',
      'email (string) - Candidate email',
      'company_name (string) - Company name',
      'role_applying_for (string) - Role being applied for',
      'criticality_level (enum) - Assessment criticality level',
      'previousStageResults (object) - Results from Stage 2 analysis',
    ],
    'ConsensusResult': [
      'candidateCV (string) - Candidate CV/resume content',
      'jobDescription (string) - Job description and requirements',
      'name (string) - Candidate name',
      'email (string) - Candidate email',
      'company_name (string) - Company name',
      'role_applying_for (string) - Role being applied for',
      'criticality_level (enum) - Assessment criticality level',
      'previousStageResults (object) - Results from Stage 1 interviews',
    ],
  };

  // Add output fields from known schemas
  const knownOutputFields: Record<string, string[]> = {
    'AssessmentResult': [
      'decision (hire|declined|maybe)',
      'score (0-100)',
      'narrative (optional: string min 10 chars OR array of { heading, summary } - interviewers)',
      'consensus_assessment (optional, array of { heading, summary } - consensus agent)',
      'strengths (array)',
      'concerns (array)',
      'recommendations (array)',
      'growth_potential (min 10 chars)',
      'leadership_level (min 20 chars)',
      'cultural_fit_level (min 10 chars)',
      'team_integration_potential (min 10 chars)',
      'interview_questions (optional array)',
    ],
    'CareerGuidanceResult': [
      'career_advice (min 300 words)',
      'interview_feedback_summary (each key array of { heading, summary })',
    ],
    'CVOptimizationResult': [
      'optimized_cv (object)',
      'changes_made (array)',
      'rationale (array of { heading, summary })',
      'ats_optimization (string)',
      'keyword_enhancements (array)',
    ],
    'FinalDecisionResult': [
      'final_decision (hire|declined|maybe)',
      'confidence (0-100)',
      'reasoning (array of { heading, summary })',
      'next_steps (array)',
    ],
    'ConsensusResult': [
      'All AssessmentResult fields (decision, score, consensus_assessment, strengths, concerns, recommendations, growth_potential, leadership_level, cultural_fit_level, team_integration_potential)',
      'final_decision (hire|declined|maybe)',
      'confidence (0-100)',
      'reasoning (array of { heading, summary })',
      'next_steps (array)',
    ],
  };
  
  // Fill in known fields - always use known fields as they're more accurate
  for (const schema of schemas.values()) {
    if (inputFieldsBySchema[schema.schemaName]) {
      schema.inputFields = inputFieldsBySchema[schema.schemaName];
    }
    if (knownOutputFields[schema.schemaName]) {
      schema.outputFields = knownOutputFields[schema.schemaName];
    }
  }
  
  // Sort schemas: common ones first (used by multiple agents)
  const sortedSchemas = Array.from(schemas.values()).sort((a, b) => {
    // Common schemas (used by 2+ agents) first
    if (a.usedBy.length > 1 && b.usedBy.length <= 1) return -1;
    if (a.usedBy.length <= 1 && b.usedBy.length > 1) return 1;
    // Then by name
    return a.schemaName.localeCompare(b.schemaName);
  });

  // Generate output
  let output = '# Output Schemas Extracted from Prompts\n\n';
  output += 'This document lists all output schemas found in the prompts.\n';
  output += 'Common schemas (used by multiple agents) are shown only once.\n\n';
  output += `Generated: ${new Date().toISOString()}\n\n`;
  output += '---\n\n';

  for (const schema of sortedSchemas) {
    const isCommon = schema.usedBy.length > 1;
    output += `## ${schema.schemaName}\n\n`;
    
    if (isCommon) {
      output += `**Common Schema** - Used by ${schema.usedBy.length} agents:\n`;
    } else {
      output += `**Unique Schema** - Used by:\n`;
    }
    
    output += schema.usedBy.map(name => `- ${name}`).join('\n');
    output += '\n\n';
    
    if (schema.inputFields.length > 0) {
      output += `**Input Fields:**\n`;
      output += schema.inputFields.map(field => `- ${field}`).join('\n');
      output += '\n\n';
    }
    
    if (schema.outputFields.length > 0) {
      output += `**Output Fields:**\n`;
      output += schema.outputFields.map(field => `- ${field}`).join('\n');
      output += '\n\n';
    }
    
    output += '---\n\n';
  }

  // Write to file
  const outputPath = path.join(outputDir, 'output_schemas.md');
  fs.writeFileSync(outputPath, output, 'utf-8');
  
  console.log(`\n✅ Created: ${outputPath}`);
  console.log(`📊 Total unique schemas: ${sortedSchemas.length}`);
  console.log(`📊 Common schemas: ${sortedSchemas.filter(s => s.usedBy.length > 1).length}`);
  console.log(`📊 Unique schemas: ${sortedSchemas.filter(s => s.usedBy.length === 1).length}`);
}

function mapOutputSchemaToResult(outputSchema: string): string | null {
  const mapping: Record<string, string> = {
    'assessment': 'AssessmentResult',
    'career_guidance': 'CareerGuidanceResult',
    'cv_optimization': 'CVOptimizationResult',
    'final_decision': 'FinalDecisionResult',
    'consensus': 'ConsensusResult',
  };
  
  return mapping[outputSchema] || null;
}

// Run the extraction
extractOutputSchemas().catch(console.error);

