/**
 * generateTrainingData.ts
 *
 * Produces JSONL training files per industry/role for:
 *  - assessment.jsonl (candidate_profile + assessment_result)
 *  - cv_optimization.jsonl (candidate_profile + cv_optimization_result)
 *  - career_guidance.jsonl (candidate_profile + career_guidance_result)
 *
 * Validates against the provided Zod schemas.
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import path from "path";
import { z } from "zod";

/* ============================
   ZOD SCHEMAS (exact as provided)
   ============================ */

export const CandidateProfileSchema = z.object({
  name: z.string(),
  email: z.string(),
  company_name: z.string(),
  role_applying_for: z.string(),
  cv_content: z.string(),
  job_requirements: z.string(),
  criticality_level: z
    .enum([
      "critical",
      "thorough",
      "objective",
      "lenient",
      "harsh",
      "easygoing",
      "constructive",
    ])
    .default("objective"),
});

export const InterviewQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  focus_area: z.string(),
});

export const AssessmentResultSchema = z.object({
  decision: z.enum(["hire", "declined", "maybe"]),
  score: z.number().min(0).max(100),
  narrative: z.string().min(10),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  recommendations: z.array(z.string()),
  growth_potential: z.string().min(10),
  leadership_level: z.string().min(20),
  cultural_fit_level: z.string().min(10),
  team_integration_potential: z.string().min(10),
  interview_questions: z.array(InterviewQuestionSchema).optional(),
});

export const CVOptimizationResultSchema = z.object({
  optimized_cv: z.record(z.any()),
  changes_made: z.array(z.string()),
  rationale: z.string(),
  ats_optimization: z.string(),
  keyword_enhancements: z.array(z.string()),
});

export const InterviewFeedbackSummarySchema = z.object({
  technical: z.string(),
  soft_skills: z.string(),
  leadership: z.string(),
  recruiter: z.string(),
  hiring_manager: z.string(),
});

export const CareerGuidanceResultSchema = z.object({
  career_advice: z.string().min(300), // Minimum 300 characters
  interview_feedback_summary: InterviewFeedbackSummarySchema,
});

export const FinalDecisionResultSchema = z.object({
  final_decision: z.enum(["hire", "declined", "maybe"]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  next_steps: z.array(z.string()),
});

/* A few composite validation wrappers (task-specific) */
const AssessmentExampleSchema = z.object({
  candidate_profile: CandidateProfileSchema,
  assessment_result: AssessmentResultSchema,
});

const CVOptimizationExampleSchema = z.object({
  candidate_profile: CandidateProfileSchema,
  cv_optimization_result: CVOptimizationResultSchema,
});

const CareerGuidanceExampleSchema = z.object({
  candidate_profile: CandidateProfileSchema,
  career_guidance_result: CareerGuidanceResultSchema,
});

/* ============================
   CONFIG
   ============================ */

const config = {
  outputBaseDir: path.resolve(process.cwd(), "prompts", "generator", "training_data"),
  cleanOutputBeforeRun: true,
  samplesPerSeniority: 50, // default per seniority (changeable)
  industries: {
    Technology: [
      "Software Developer",
      "Frontend Developer",
      "Backend Developer",
      "Fullstack Developer",
      "DevOps Engineer",
      "Data Scientist",
      "Solutions Architect",
      "Cloud Architect",
      "Enterprise Architect",
      "Engineering Manager",
      "Scrum Master",
      "Product Manager",
      "Technical Product Manager",
      "QA Tester",
      "Release Manager",
    ],
    Finance: [
      "Controller",
      "Chief Financial Officer",
      "Auditor",
      "Financial Analyst",
      "Risk Manager",
      "Compliance Officer",
      "Accountant",
    ],
    Healthcare: [
      "Medical Coder",
      "Healthcare Administrator",
      "Nurse",
      "Medical Researcher",
      "Clinical Data Analyst",
    ],
    Retail: [
      "Store Manager",
      "Sales Associate",
      "Merchandiser",
      "Customer Success Manager",
    ],
  } as Record<string, string[]>,
  seniorities: [
    "Intern",
    "Junior",
    "Mid-level",
    "Senior",
    "Lead",
    "Principal",
    "Director",
    "VP",
    "C-Level",
  ] as string[],
};

/* ============================
   SMALL HELPERS
   ============================ */

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Ensure minimum-length character output (safe)
function loremMinChars(minChars: number): string {
  const base =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent at sapien vitae velit pharetra gravida. ";
  let out = "";
  while (out.length < minChars) out += base;
  return out.slice(0, minChars);
}

const firstNames = [
  "Alex",
  "Jamie",
  "Taylor",
  "Morgan",
  "Casey",
  "Jordan",
  "Riley",
  "Sam",
  "Charlie",
  "Drew",
  "Cameron",
  "Quinn",
  "Parker",
  "Reese",
  "Blake",
  "Avery",
  "Dakota",
  "Jesse",
  "Skyler",
  "Harper",
];

const lastNames = [
  "Smith",
  "Johnson",
  "Brown",
  "Taylor",
  "Anderson",
  "Thomas",
  "Jackson",
  "White",
  "Harris",
  "Martin",
  "Thompson",
  "Garcia",
  "Martinez",
  "Robinson",
  "Clark",
  "Rodriguez",
  "Lewis",
  "Lee",
  "Walker",
  "Hall",
];

function generateRandomName(): { first: string; last: string; full: string } {
  const first = sample(firstNames);
  const last = sample(lastNames);
  return { first, last, full: `${first} ${last}` };
}

function sanitizeFileName(s: string) {
  return s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_");
}

/* ============================
   ROLE SKILLS & QUESTIONS (expandable)
   ============================ */

const skillsByRole: Record<
  string,
  {
    technical: string[];
    leadership: string[];
    soft: string[];
    communication: string[];
    teamFit: string[];
  }
> = {
  "Software Developer": {
    technical: [
      "JavaScript",
      "TypeScript",
      "Python",
      "Java",
      "Git",
      "REST APIs",
      "SQL",
      "Docker",
      "CI/CD",
    ],
    leadership: ["Mentorship", "Code Review Leadership"],
    soft: ["Problem Solving", "Collaboration", "Adaptability"],
    communication: ["Documentation", "Standup & Sprint updates"],
    teamFit: ["Agile Team Player", "Proactive"],
  },
  "Solutions Architect": {
    technical: [
      "Cloud Architecture (AWS/Azure/GCP)",
      "Microservices",
      "Containerization",
      "Networking",
      "Security",
    ],
    leadership: ["Driving Architecture Decisions", "Cross-team Coordination"],
    soft: ["Strategic Thinking", "Stakeholder Management"],
    communication: ["Technical Presentations", "Requirement Elicitation"],
    teamFit: ["Mentorship", "Vision Alignment"],
  },
  "Product Manager": {
    technical: ["Roadmapping", "User Stories", "A/B Testing", "Analytics"],
    leadership: ["Product Vision", "Cross-Functional Leadership"],
    soft: ["Customer Empathy", "Prioritization"],
    communication: ["Stakeholder Communication", "PRDs"],
    teamFit: ["Customer Focus", "Cross-functional Collaboration"],
  },
  "Scrum Master": {
    technical: ["Scrum Framework", "Kanban", "Jira"],
    leadership: ["Servant Leadership", "Impediment Removal"],
    soft: ["Facilitation", "Coaching"],
    communication: ["Meeting Facilitation"],
    teamFit: ["Supportive", "Encouraging"],
  },
  // Extend more roles as needed...
};

/* Interview question bank (partial, expandable) */
const interviewQuestionsBank: Record<
  string,
  { difficulty: "easy" | "medium" | "hard"; text: string; focus_area: string }[]
> = {
  "Software Developer": [
    { difficulty: "easy", text: "What is a REST API?", focus_area: "technical" },
    { difficulty: "medium", text: "Explain event loop in JS.", focus_area: "technical" },
    {
      difficulty: "hard",
      text: "Design a scalable system to handle millions of requests.",
      focus_area: "systems",
    },
  ],
  "Solutions Architect": [
    { difficulty: "easy", text: "Benefits of cloud computing?", focus_area: "technical" },
    {
      difficulty: "medium",
      text: "How would you design a multi-region failover?",
      focus_area: "architecture",
    },
    {
      difficulty: "hard",
      text: "Explain disaster recovery for stateful services.",
      focus_area: "architecture",
    },
  ],
  "Product Manager": [
    { difficulty: "easy", text: "How do you gather user feedback?", focus_area: "product" },
    {
      difficulty: "medium",
      text: "How do you prioritize conflicting feature requests?",
      focus_area: "product",
    },
    { difficulty: "hard", text: "Describe a product you built end-to-end.", focus_area: "leadership" },
  ],
  "Scrum Master": [
    { difficulty: "easy", text: "What are Scrum ceremonies?", focus_area: "agile" },
    { difficulty: "medium", text: "How do you run a retro?", focus_area: "agile" },
    { difficulty: "hard", text: "How do you scale Scrum across teams?", focus_area: "agile" },
  ],
};

/* ============================
   GENERATORS (task-specific)
   ============================ */

function generateInterviewQuestionsForRole(role: string, count = 2) {
  const bank = interviewQuestionsBank[role] || [];
  const shuffled = bank.slice().sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map((q, i) => ({
    id: `${sanitizeFileName(role)}-${q.difficulty}-${i + 1}`,
    text: q.text,
    difficulty: q.difficulty as "easy" | "medium" | "hard",
    focus_area: q.focus_area,
  }));
}

function generateCandidateProfile(role: string, seniority: string, industry: string) {
  const { first, last, full } = generateRandomName();
  return {
    name: full,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    company_name: `${industry} Innovations LLC`,
    role_applying_for: `${seniority} ${role}`,
    cv_content: `Experienced ${seniority} ${role}. ${loremMinChars(120)}`,
    job_requirements: `Seeking ${seniority} ${role} with relevant skills. ${loremMinChars(80)}`,
    criticality_level: sample([
      "critical",
      "thorough",
      "objective",
      "lenient",
      "harsh",
      "easygoing",
      "constructive",
    ]) as z.infer<typeof CandidateProfileSchema>["criticality_level"],
  };
}

/* Assessment example generator: includes candidate_profile + assessment_result */
function generateAssessmentExample(role: string, seniority: string, industry: string) {
  const candidate_profile = generateCandidateProfile(role, seniority, industry);

  const skills = skillsByRole[role] || {
    technical: ["domain knowledge"],
    leadership: ["leadership"],
    soft: ["communication"],
    communication: ["written"],
    teamFit: ["collaborative"],
  };

  const interview_questions = generateInterviewQuestionsForRole(role, 2);

  // Ensure min-length fields
  const narrative = loremMinChars(80); // >=10
  const leadership_level = loremMinChars(40); // >=20
  const growth_potential = loremMinChars(80); // >=10
  const cultural_fit_level = loremMinChars(30); // >=10
  const team_integration_potential = loremMinChars(30); // >=10

  const strengths = [
    `Strong technical background: ${sample(skills.technical)}`,
    `Good communication: ${sample(skills.communication)}`,
  ];
  const concerns = [sample(skills.soft), "Limited cross-team exposure"];
  const recommendations = ["Mentorship program", "Cross-team rotation"];

  const assessment_result = {
    decision: sample(["hire", "declined", "maybe"]) as z.infer<
      typeof AssessmentResultSchema
    >["decision"],
    score: Math.floor(Math.random() * 101),
    narrative,
    strengths,
    concerns,
    recommendations,
    growth_potential,
    leadership_level,
    cultural_fit_level,
    team_integration_potential,
    interview_questions: interview_questions.length > 0 ? interview_questions : undefined,
  };

  return { candidate_profile, assessment_result };
}

/* CV optimization example generator */
function generateCvOptimizationExample(role: string, seniority: string, industry: string) {
  const candidate_profile = generateCandidateProfile(role, seniority, industry);

  const skills = skillsByRole[role] || {
    technical: ["domain knowledge"],
    leadership: ["leadership"],
    soft: ["communication"],
    communication: ["written"],
    teamFit: ["collaborative"],
  };

  const optimized_cv = {
    summary: `Optimized CV for ${candidate_profile.name} - ${role}`,
    sections: {
      experience: [
        {
          company: candidate_profile.company_name,
          title: `${seniority} ${role}`,
          bullets: [loremMinChars(120)],
        },
      ],
    },
    keywords: [...skills.technical.slice(0, 5)],
  };

  const cv_optimization_result = {
    optimized_cv,
    changes_made: ["Improved summary", "Highlighted measurable outcomes", "Added keywords"],
    rationale: loremMinChars(80),
    ats_optimization: "Added ATS-friendly headings and keyword density",
    keyword_enhancements: skills.technical.slice(0, 8),
  };

  return { candidate_profile, cv_optimization_result };
}

/* Career guidance / coaching example generator */
function generateCareerGuidanceExample(role: string, seniority: string, industry: string) {
  const candidate_profile = generateCandidateProfile(role, seniority, industry);

  const interview_feedback_summary = {
    technical: loremMinChars(60),
    soft_skills: loremMinChars(60),
    leadership: loremMinChars(60),
    recruiter: loremMinChars(60),
    hiring_manager: loremMinChars(60),
  };

  const career_guidance_result = {
    career_advice: loremMinChars(1000), // >=300 chars
    interview_feedback_summary,
  };

  return { candidate_profile, career_guidance_result };
}

/* ============================
   VALIDATION & LOGGING
   ============================ */

const validationLogPath = path.join(config.outputBaseDir, "validation_errors.log");

async function logValidationError(context: string, err: unknown, item: any) {
  const entry = {
    timestamp: new Date().toISOString(),
    context,
    error: err instanceof Error ? err.message : JSON.stringify(err),
    details: err && typeof err === "object" && "errors" in (err as any) ? (err as any).errors : undefined,
    item,
  };
  const entryText = JSON.stringify(entry, null, 2) + "\n\n";
  await fsp.mkdir(path.dirname(validationLogPath), { recursive: true }).catch(() => {});
  await fsp.appendFile(validationLogPath, entryText, "utf8").catch(() => {});
}

/* ============================
   MAIN: Clean, generate, validate, write
   ============================ */

async function cleanOutputDir(outputDir: string) {
  if (config.cleanOutputBeforeRun && (await exists(outputDir))) {
    console.log(`Cleaning existing output directory: ${outputDir}`);
    await fsp.rm(outputDir, { recursive: true, force: true });
  }
  await fsp.mkdir(outputDir, { recursive: true });
}

async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonlFile(filePath: string, lines: string[]) {
  // Ensure dir exists
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // Write entire file in single write (we're writing full arrays in memory then flush)
  const content = lines.join("\n") + (lines.length ? "\n" : "");
  await fsp.writeFile(filePath, content, "utf8");
}

async function generateAll() {
  const base = config.outputBaseDir;
  await cleanOutputDir(base);

  // clear validation log
  await fsp.writeFile(validationLogPath, "", "utf8").catch(() => {});

  const industries = Object.keys(config.industries);

  for (const industry of industries) {
    const roles = config.industries[industry];
    const industryDir = path.join(base, sanitizeFileName(industry));
    await fsp.mkdir(industryDir, { recursive: true });

    for (const role of roles) {
      const roleDir = path.join(industryDir, sanitizeFileName(role));
      await fsp.mkdir(roleDir, { recursive: true });

      // We'll build three arrays in memory and flush:
      const assessmentLines: string[] = [];
      const cvOptLines: string[] = [];
      const careerGuidanceLines: string[] = [];

      for (const seniority of config.seniorities) {
        // Generate N examples per seniority
        for (let i = 0; i < config.samplesPerSeniority; i++) {
          // --- ASSESSMENT example ---
          try {
            const assessmentExample = generateAssessmentExample(role, seniority, industry);
            // Validate
            AssessmentExampleSchema.parse(assessmentExample);
            const prompt = JSON.stringify(assessmentExample.candidate_profile) + "\n\n";
            const completion = JSON.stringify(assessmentExample.assessment_result) + "\n";
            assessmentLines.push(
              JSON.stringify({ prompt, completion })
            );
          } catch (err) {
            await logValidationError(`${industry}/${role}/assessment/${seniority}`, err, null);
            // skip
          }

          // --- CV OPT example ---
          try {
            const cvExample = generateCvOptimizationExample(role, seniority, industry);
            CVOptimizationExampleSchema.parse(cvExample);
            const prompt = JSON.stringify(cvExample.candidate_profile) + "\n\n";
            const completion = JSON.stringify(cvExample.cv_optimization_result) + "\n";
            cvOptLines.push(JSON.stringify({ prompt, completion }));
          } catch (err) {
            await logValidationError(`${industry}/${role}/cv_optimization/${seniority}`, err, null);
            // skip
          }

          // --- CAREER GUIDANCE example ---
          try {
            const cgExample = generateCareerGuidanceExample(role, seniority, industry);
            CareerGuidanceExampleSchema.parse(cgExample);
            const prompt = JSON.stringify(cgExample.candidate_profile) + "\n\n";
            const completion = JSON.stringify(cgExample.career_guidance_result) + "\n";
            careerGuidanceLines.push(JSON.stringify({ prompt, completion }));
          } catch (err) {
            await logValidationError(`${industry}/${role}/career_guidance/${seniority}`, err, null);
            // skip
          }
        } // end samples per seniority
      } // end seniorities loop

      // flush arrays to disk as JSONL per task type
      const assessmentPath = path.join(roleDir, "assessment.jsonl");
      const cvOptPath = path.join(roleDir, "cv_optimization.jsonl");
      const careerGuidancePath = path.join(roleDir, "career_guidance.jsonl");

      await writeJsonlFile(assessmentPath, assessmentLines);
      await writeJsonlFile(cvOptPath, cvOptLines);
      await writeJsonlFile(careerGuidancePath, careerGuidanceLines);

      console.log(
        `Wrote for ${industry}/${role}: assessment=${assessmentLines.length}, cv_opt=${cvOptLines.length}, career_guidance=${careerGuidanceLines.length}`
      );
    }
  }

  console.log("Generation complete. Validation errors (if any) logged at:", validationLogPath);
}

/* ============================
   Run
   ============================ */

generateAll().catch(async (err) => {
  console.error("Fatal error during generation:", err);
  await logValidationError("fatal", err, null);
  process.exit(1);
});
