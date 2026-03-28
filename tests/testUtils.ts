import { readFile } from 'fs/promises';
import path from 'path';
import { CandidateProfile } from '../src/recruitment/agents/AgentBuilder';
import { ExecutionTimeTracker } from '../src/recruitment/utils/ExecutionTimeTracker';
import type { RequestScopedContext } from '../src/recruitment/requestScopedContext';
import { INSUFFICIENT_QUOTA_TEST_MESSAGE, type StageResult } from '../src/recruitment/pipeline/PipelineRunner';

/**
 * Parses the sample_candidates.md file and extracts candidate profiles
 */
export async function loadSampleCandidates(): Promise<CandidateProfile[]> {
  const filePath = path.resolve(__dirname, 'sample_candidates.md');
  const content = await readFile(filePath, 'utf-8');
  
  const candidates: CandidateProfile[] = [];
  
  // Split by candidate sections (## Sample Candidate)
  const candidateSections = content.split(/^## Sample Candidate \d+:/m);
  
  for (const section of candidateSections.slice(1)) { // Skip first empty section
    const candidate = parseCandidateSection(section);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  
  return candidates;
}

/**
 * Parses a single candidate section from the markdown file
 */
function parseCandidateSection(section: string): CandidateProfile | null {
  // Extract name
  const nameMatch = section.match(/- \*\*Name\*\*: (.+)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();
  
  // Extract email
  const emailMatch = section.match(/- \*\*Email\*\*: (.+)/);
  if (!emailMatch) return null;
  const email = emailMatch[1].trim();
  
  // Extract company
  const companyMatch = section.match(/- \*\*Company\*\*: (.+)/);
  if (!companyMatch) return null;
  const company_name = companyMatch[1].trim();
  
  // Extract role
  const roleMatch = section.match(/- \*\*Role Applying For\*\*: (.+)/);
  if (!roleMatch) return null;
  const role_applying_for = roleMatch[1].trim();
  
  // Extract criticality level
  const criticalityMatch = section.match(/- \*\*Criticality Level\*\*: (.+)/);
  const criticality_level = (criticalityMatch?.[1]?.trim() || 'objective') as 'critical' | 'thorough' | 'objective' | 'lenient' | 'harsh' | 'easygoing' | 'constructive';

  // Extract verbosity level (optional, default moderate)
  const verbosityMatch = section.match(/- \*\*Verbosity Level\*\*: (.+)/);
  const verbosity_level = (verbosityMatch?.[1]?.trim() || 'moderate') as 'concise' | 'moderate' | 'detailed';

  // Extract CV optimization level (optional, default moderate)
  const cvOptMatch = section.match(/- \*\*CV Optimization Level\*\*: (.+)/);
  const cv_optimization_level = (cvOptMatch?.[1]?.trim() || 'moderate') as 'conservative' | 'moderate' | 'aggressive';
  
  // Extract CV Content (between ``` markers)
  const cvMatch = section.match(/### CV Content\s*```[^\n]*\n([\s\S]*?)```/);
  if (!cvMatch) return null;

  // Extract Job Requirements (between ``` markers) - optional, as it may be in a separate file
  const jobMatch = section.match(/### Job Requirements\s*```[^\n]*\n([\s\S]*?)```/);
  const jobRequirementsText = jobMatch ? jobMatch[1].trim() : '';

  // CandidateProfile requires structured_cv (section-based: header + sections)
  const structured_cv = {
    header: { full_name: name, professional_title: role_applying_for, contact: { email } },
    sections: [
      { id: 'summary-1', section_title: 'Summary', kind: 'summary' as const, content: { text: '' } },
      { id: 'skills-1', section_title: 'Skills', kind: 'skills' as const, content: { categories: [{ category_name: 'Tech', skills: ['TypeScript'] }] } },
      { id: 'experience-1', section_title: 'Experience', kind: 'experience' as const, content: { items: [] } },
    ],
  };
  const structured_job_description = {
    role_title: role_applying_for,
    company: company_name,
    summary: jobRequirementsText,
  };

  return {
    name,
    email,
    company_name,
    role_applying_for,
    structured_cv,
    structured_job_description,
    criticality_level,
    verbosity_level,
    cv_optimization_level,
    audience_perspective: 'candidate' as const,
    job_posted_by_recruiter: false,
  };
}

/**
 * Loads job requirements from the job_requirements.md file
 */
export async function loadJobRequirements(): Promise<string> {
  const filePath = path.resolve(__dirname, 'job_requirements.md');
  const content = await readFile(filePath, 'utf-8');
  return content.trim();
}

/**
 * Gets the first sample candidate (for convenience in tests)
 * Job requirements are loaded from the separate job_requirements.md file
 */
export async function getSampleCandidate(): Promise<CandidateProfile> {
  const candidates = await loadSampleCandidates();
  if (candidates.length === 0) {
    throw new Error('No sample candidates found in sample_candidates.md');
  }
  
  const candidate = candidates[0];
  const jobRequirements = await loadJobRequirements();
  return {
    ...candidate,
    structured_job_description: {
      ...candidate.structured_job_description,
      summary: jobRequirements,
    },
  };
}

/**
 * Creates a request-scoped context for tests (e.g. runPipeline(context)).
 * Each call returns a new tracker and unique runId/correlationToken for concurrent-safety.
 */
export function createTestRequestContext(overrides?: Partial<RequestScopedContext>): RequestScopedContext {
  const correlationToken = overrides?.correlationToken ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const runId = overrides?.runId ?? `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tracker = overrides?.tracker ?? new ExecutionTimeTracker();
  tracker.initialize(runId, Date.now());
  return {
    correlationToken,
    sessionToken: overrides?.sessionToken ?? null,
    runId,
    tracker,
  };
}

/**
 * Gets a sample candidate by index
 * Job requirements are loaded from the separate job_requirements.md file
 */
export async function getSampleCandidateByIndex(index: number): Promise<CandidateProfile> {
  const candidates = await loadSampleCandidates();
  if (index >= candidates.length) {
    throw new Error(`Sample candidate index ${index} not found. Only ${candidates.length} candidates available.`);
  }
  
  const candidate = candidates[index];
  const jobRequirements = await loadJobRequirements();
  return {
    ...candidate,
    structured_job_description: {
      ...candidate.structured_job_description,
      summary: jobRequirements,
    },
  };
}

/**
 * Call after running the pipeline in tests. If any agent failed with insufficient_quota,
 * prints a clear message and exits the process (exit code 1) so no further tests run.
 * PipelineRunner also exits on this when running under Jest.
 */
export function failFastOnQuotaError(stageResults: StageResult[]): void {
  for (const stage of stageResults) {
    for (const r of stage.results) {
      if (
        !r.success &&
        (r.error?.code === 'insufficient_quota' ||
          r.error?.message?.includes('exceeded your current quota'))
      ) {
        const msg = `${INSUFFICIENT_QUOTA_TEST_MESSAGE} Failed at stage: ${stage.stageName}, agent: ${r.agentName}.`;
        console.error('\n' + msg + '\n');
        process.exit(1);
      }
    }
  }
}

