/**
 * Comprehensive API Endpoint Tests
 * 
 * Tests the actual API endpoint that the frontend calls: POST /recruitment-simulation/assessment
 * Validates response payloads, ensures error messages are in error fields (not result content),
 * and verifies structured data is properly formatted.
 */

import fs from 'fs';
import path from 'path';

const API_URL = process.env.API_URL || 'http://localhost:8000';
const ENDPOINT = `${API_URL}/recruitment-simulation/assessment`;

/**
 * NOTE: This test requires the API server to be running.
 * Start the API server first:
 *   npm run dev:api
 * 
 * Then run this test:
 *   npm run test:api
 */

/**
 * Creates a test CV file content
 */
function createTestCV(): string {
  return `John Doe
Software Engineer
Email: john.doe@example.com
Phone: +1-555-0123
Location: San Francisco, CA

PROFESSIONAL SUMMARY
Experienced software engineer with 5+ years developing web applications using JavaScript, TypeScript, React, and Node.js. Proven track record of building scalable systems and leading technical initiatives.

WORK EXPERIENCE
Senior Software Engineer | Tech Corp | January 2020 - Present
- Led development of customer-facing web applications serving 1M+ users
- Built RESTful APIs using Node.js and Express, handling 10K+ requests/minute
- Implemented React components with TypeScript, improving code quality by 40%
- Mentored junior developers and established coding standards

Software Engineer | Startup Inc | June 2018 - December 2020
- Developed frontend features using React and Redux
- Collaborated with cross-functional teams in Agile environment
- Maintained code quality and best practices, reducing bugs by 30%

EDUCATION
Bachelor of Science in Computer Science
State University | 2014 - 2018
GPA: 3.8/4.0

TECHNICAL SKILLS
Programming Languages: JavaScript, TypeScript, Python, Java
Frameworks: React, Node.js, Express, Next.js
Tools: Git, Docker, AWS, Jenkins
Databases: PostgreSQL, MongoDB, Redis

CERTIFICATIONS
- AWS Certified Solutions Architect (2022)
- Google Cloud Professional Cloud Architect (2021)

AWARDS
- Employee of the Year, Tech Corp (2023)
- Best Technical Innovation Award (2022)`;
}

/**
 * Creates a test job description
 */
function createTestJobDescription(): string {
  return `Senior Software Engineer Position

Company: Tech Company
Location: San Francisco, CA (Remote)

Job Summary:
We are seeking an experienced Senior Software Engineer to join our growing team. You will be responsible for designing and developing scalable web applications and APIs.

Required Skills:
- 5+ years of software development experience
- Strong proficiency in JavaScript, TypeScript, React, and Node.js
- Experience building RESTful APIs
- Knowledge of cloud platforms (AWS preferred)
- Experience with databases (PostgreSQL, MongoDB)

Preferred Skills:
- Experience with Docker and containerization
- Knowledge of microservices architecture
- Experience with CI/CD pipelines
- Leadership and mentoring experience

Responsibilities:
- Design and develop scalable web applications
- Build and maintain RESTful APIs
- Collaborate with cross-functional teams
- Mentor junior developers
- Participate in code reviews and technical discussions

Qualifications:
- Bachelor's degree in Computer Science or related field
- 5+ years of professional software development experience
- Strong problem-solving and communication skills

Benefits:
- Competitive salary
- Health insurance
- 401(k) matching
- Flexible work arrangements`;
}

/**
 * Validates that result fields contain valid data, not error messages
 */
function validateResultFields(agent: any, agentName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (agent.error) {
    // If there's an error field, result should be null
    if (agent.result !== null) {
      errors.push(`${agentName}: Has error field but result is not null`);
    }
    // Error field should have proper structure
    if (!agent.error.message) {
      errors.push(`${agentName}: Error field missing message`);
    }
    if (agent.error.code === 'invalid_json_schema') {
      errors.push(`${agentName}: Invalid JSON schema returned by model response_format (${agent.error.message})`);
    }
  } else {
    // If no error, result should contain valid data
    if (agent.result === null || agent.result === undefined) {
      errors.push(`${agentName}: No error but result is null/undefined`);
    } else if (typeof agent.result === 'string') {
      // Result should not be a string (error message)
      if (agent.result.toLowerCase().includes('error') || 
          agent.result.toLowerCase().includes('failed') ||
          agent.result.toLowerCase().includes('exception')) {
        errors.push(`${agentName}: Result contains error message: "${agent.result.substring(0, 100)}"`);
      }
    } else if (typeof agent.result === 'object') {
      // Validate result structure based on outputSchema
      const schema = agent.outputSchema;
      if (schema === 'assessment') {
        const sections = agent.result.sections;
        const hasSectionsWithNarrative =
          Array.isArray(sections) &&
          sections.some((s: any) => s?.type === 'narrative' && s?.section_detail != null);
        if (!agent.result.decision || !agent.result.score || !hasSectionsWithNarrative) {
          errors.push(`${agentName}: Assessment result missing required fields (decision, score, and sections with narrative section)`);
        }
      } else if (schema === 'cv_optimization') {
        const rationale = agent.result.rationale;
        const hasRationale = Array.isArray(rationale) && rationale.length > 0 && rationale.every((b: any) => b?.heading != null && b?.summary != null);
        const hasMissingSkills = Array.isArray(agent.result.missing_skills);
        if (!agent.result.optimized_cv || !agent.result.changes_made || !hasRationale || !hasMissingSkills) {
          errors.push(`${agentName}: CV optimization result missing required fields (optimized_cv, changes_made, rationale as { heading, summary }, missing_skills)`);
        }
      } else if (schema === 'career_guidance') {
        const feedback = agent.result.interview_feedback_summary;
        const hasFeedback = feedback && typeof feedback === 'object' && ['technical', 'soft_skills', 'leadership', 'recruiter', 'hiring_manager'].every((k) => Array.isArray((feedback as any)[k]));
        if (!agent.result.career_advice || !hasFeedback) {
          errors.push(`${agentName}: Career guidance result missing required fields (career_advice, interview_feedback_summary with all five keys)`);
        }
      } else if (schema === 'final_decision') {
        const reasoning = agent.result.reasoning;
        const hasReasoning = Array.isArray(reasoning) && reasoning.length > 0 && reasoning.every((b: any) => b?.heading != null && b?.summary != null);
        if (!agent.result.final_decision || agent.result.confidence === undefined || !hasReasoning) {
          errors.push(`${agentName}: Final decision result missing required fields (reasoning as { heading, summary })`);
        }
      } else if (schema === 'consensus') {
        const sections = agent.result.sections;
        const hasSectionsWithNarrative =
          Array.isArray(sections) &&
          sections.some((s: any) => s?.type === 'narrative' && s?.section_detail != null);
        const hasNextStepsSection =
          Array.isArray(sections) && sections.some((s: any) => s?.type === 'next_steps');
        const hasReasoning =
          agent.result.reasoning != null &&
          typeof agent.result.reasoning === 'object' &&
          !Array.isArray(agent.result.reasoning);
        if (!agent.result.decision || !agent.result.score || !hasSectionsWithNarrative) {
          errors.push(`${agentName}: Consensus result missing required assessment fields (decision, score, sections with narrative section)`);
        }
        if (!agent.result.final_decision || agent.result.confidence === undefined || !hasReasoning || !hasNextStepsSection) {
          errors.push(`${agentName}: Consensus result missing required decision fields (final_decision, confidence, reasoning, sections with next_steps)`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Main test function
 */
async function testAPIEndpoint() {
  console.log('='.repeat(80));
  console.log('API Endpoint Test: POST /recruitment-simulation/assessment');
  console.log('='.repeat(80));
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log('');

  // Create test CV file
  const testCVContent = createTestCV();
  const testFilePath = path.join(process.cwd(), 'tests', 'test-cv-api.txt');
  fs.writeFileSync(testFilePath, testCVContent);
  
  try {
    // Use native FormData (compatible with fetch)
    const formData = new FormData();
    
    // Simulate exactly what the frontend sends
    const fileBuffer = fs.readFileSync(testFilePath);
    const fileBlob = new Blob([fileBuffer], { type: 'text/plain' });
    formData.append('file', fileBlob, 'test-cv.txt');
    formData.append('candidate_name', 'John Doe');
    formData.append('candidate_email', 'john.doe@example.com');
    formData.append('company_name', 'Tech Company');
    formData.append('role_applying_for', 'Senior Software Engineer');
    formData.append('job_description', createTestJobDescription());
    formData.append('criticality_level', 'objective');
    formData.append('verbosity_level', 'moderate');
    formData.append('cv_optimization_level', 'moderate');

    console.log('Sending request...');
    console.log('NOTE: Ensure API server is running on', API_URL);
    console.log('');
    const startTime = Date.now();
    
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        body: formData,
      });
    } catch (fetchError) {
      if ((fetchError as any).code === 'ECONNREFUSED' || (fetchError as Error).message.includes('fetch failed')) {
        console.error('❌ TEST FAILED: Cannot connect to API server');
        console.error(`   Make sure the API server is running on ${API_URL}`);
        console.error('   Start it with: npm run dev:api (from root or api-server directory)');
        return { success: false, errors: ['API server not running'] };
      }
      throw fetchError;
    }
    
    const responseTime = Date.now() - startTime;
    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log(`Response Time: ${responseTime}ms`);
    console.log('');

    const responseText = await response.text();
    
    // Test 1: Response Format Validation (even for errors)
    let errorJson: any = null;
    if (!response.ok) {
      console.log('⚠️  Request returned non-200 status (this may be expected for configuration issues)');
      console.log(`Status: ${response.status} ${response.statusText}`);
      
      try {
        errorJson = JSON.parse(responseText);
        console.log('\nError Response Structure:');
        console.log(JSON.stringify(errorJson, null, 2));
        
        // Validate error response format - errors should be in error fields, not result content
        const hasErrorField = !!errorJson.error;
        const hasMessageField = !!errorJson.message;
        
        if (hasErrorField || hasMessageField) {
          console.log('✅ Error properly formatted in error/message fields (not in result content)');
        } else {
          console.error('❌ ERROR: Error response missing error/message fields');
          return { success: false, errors: ['Error response missing proper error fields'] };
        }
        
        // Check if this is a configuration error (not a code error)
        if (errorJson.message && (
          errorJson.message.includes('does not have access to model') ||
          errorJson.message.includes('API key') ||
          errorJson.message.includes('authentication')
        )) {
          console.log('\n⚠️  NOTE: This appears to be a configuration issue (API key/model access), not a code error.');
          console.log('   The error handling is working correctly - errors are in error fields.');
          console.log('   To fully test, ensure OpenAI API is properly configured.');
          return { success: true, errors: [], warnings: ['Configuration issue detected - test cannot complete fully'] };
        }
      } catch (e) {
        console.error('❌ ERROR: Response is not valid JSON');
        console.error('Response:', responseText.substring(0, 500));
        return { success: false, errors: ['Invalid JSON response'] };
      }
      
      // For non-configuration errors, fail the test
      if (response.status >= 500) {
        return { success: false, errors: [`Server error: ${errorJson?.message || responseText.substring(0, 200)}`] };
      }
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ TEST FAILED: Response is not valid JSON');
      console.error('Response:', responseText.substring(0, 500));
      return { success: false, errors: ['Invalid JSON response'] };
    }

    console.log('✅ Request successful!');
    console.log('');

    const errors: string[] = [];
    const warnings: string[] = [];

    // Test 2: Response Structure Validation
    console.log('Testing response structure...');
    if (!data.candidate) {
      errors.push('Response missing candidate field');
    } else {
      console.log(`  ✅ Candidate: ${data.candidate.name || 'N/A'}`);
      if (data.candidate.verbosity_level === undefined) {
        errors.push('Response candidate missing verbosity_level');
      } else {
        console.log(`  ✅ Candidate verbosity_level: ${data.candidate.verbosity_level}`);
        if (data.candidate.verbosity_level !== 'moderate') {
          errors.push(`Expected candidate.verbosity_level 'moderate', got '${data.candidate.verbosity_level}'`);
        }
      }
      if (data.candidate.cv_optimization_level === undefined) {
        errors.push('Response candidate missing cv_optimization_level');
      } else {
        console.log(`  ✅ Candidate cv_optimization_level: ${data.candidate.cv_optimization_level}`);
        if (data.candidate.cv_optimization_level !== 'moderate') {
          errors.push(`Expected candidate.cv_optimization_level 'moderate', got '${data.candidate.cv_optimization_level}'`);
        }
      }
      if (data.candidate.audience_perspective === undefined) {
        errors.push('Response candidate missing audience_perspective');
      } else {
        console.log(`  ✅ Candidate audience_perspective: ${data.candidate.audience_perspective}`);
        if (data.candidate.audience_perspective !== 'candidate' && data.candidate.audience_perspective !== 'hiring_organisation') {
          errors.push(`Expected candidate.audience_perspective 'candidate' or 'hiring_organisation', got '${data.candidate.audience_perspective}'`);
        }
      }
    }

    if (!data.stages || !Array.isArray(data.stages)) {
      errors.push('Response missing stages array');
    } else {
      console.log(`  ✅ Stages: ${data.stages.length}`);
    }

    if (!data.metadata) {
      errors.push('Response missing metadata field');
    } else {
      console.log(`  ✅ Metadata present`);
    }

    // Test 3: Response Payload Validation
    console.log('\nTesting response payloads...');
    if (data.stages && Array.isArray(data.stages)) {
      for (const stage of data.stages) {
        console.log(`\n  Stage: ${stage.stageName}`);
        
        if (!stage.agents || !Array.isArray(stage.agents)) {
          errors.push(`${stage.stageName}: Missing agents array`);
          continue;
        }

        for (const agent of stage.agents) {
          const validation = validateResultFields(agent, agent.agentName);
          
          if (!validation.valid) {
            errors.push(...validation.errors);
            console.log(`    ❌ ${agent.agentName}: Validation failed`);
            validation.errors.forEach(err => console.log(`      - ${err}`));
          } else {
            if (agent.error) {
              console.log(`    ⚠️  ${agent.agentName}: Has error (${agent.error.message})`);
            } else {
              console.log(`    ✅ ${agent.agentName}: Valid result`);
              
              // Additional validation: check for error messages in result content
              if (agent.result && typeof agent.result === 'object') {
                const resultStr = JSON.stringify(agent.result).toLowerCase();
                if (resultStr.includes('error:') || resultStr.includes('failed:') || resultStr.includes('exception:')) {
                  warnings.push(`${agent.agentName}: Result content may contain error messages`);
                }
              }
            }
          }
        }
      }
    }

    // Test 4: Structured Data Validation (if available in metadata)
    console.log('\nTesting structured data...');
    if (data.metadata?.tokenUsage) {
      console.log('  ✅ Token usage metadata present');
      if (data.metadata.tokenUsage.preprocessing) {
        console.log('  ✅ Preprocessing token usage tracked');
      } else {
        warnings.push('Preprocessing token usage not in metadata');
      }
    }

    // Test 5: Response Time
    console.log('\nTesting performance...');
    if (responseTime > 60000) {
      warnings.push(`Response time is high: ${responseTime}ms (expected < 60s)`);
    } else {
      console.log(`  ✅ Response time: ${responseTime}ms`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    
    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ ALL TESTS PASSED');
      console.log(`\nResponse structure: Valid`);
      console.log(`Response payloads: Valid`);
      console.log(`Error handling: Valid`);
      console.log(`Performance: Acceptable`);
      return { success: true, errors: [], warnings: [] };
    } else {
      if (errors.length > 0) {
        console.error(`❌ FAILED: ${errors.length} error(s)`);
        errors.forEach(err => console.error(`  - ${err}`));
      }
      if (warnings.length > 0) {
        console.warn(`⚠️  WARNINGS: ${warnings.length} warning(s)`);
        warnings.forEach(warn => console.warn(`  - ${warn}`));
      }
      return { success: errors.length === 0, errors, warnings };
    }

  } catch (error) {
    console.error('❌ TEST FAILED: Exception occurred');
    console.error('Error:', (error as Error).message);
    console.error('Stack:', (error as Error).stack);
    return { success: false, errors: [(error as Error).message] };
  } finally {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
}

// Run test if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testAPIEndpoint()
    .then(result => {
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { testAPIEndpoint, validateResultFields, createTestCV, createTestJobDescription };
