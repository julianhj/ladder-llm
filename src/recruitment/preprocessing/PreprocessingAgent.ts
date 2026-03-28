import { getOpenAIConfig, getOpenAIClient } from '../agents/AgentBuilder.js';
import { getSchema } from '../agents/schemaRegistry.js';
import { loadCommonPromptFragments } from '../agents/promptLoader.js';
import { StructuredCV, StructuredJobDescription } from '../schemas/StructuredInputs.js';
import { Logger } from '../utils/Logger.js';
import { parsePromptYamlToObject, replaceNewlinesInStrings } from '../utils/PromptVersion.js';
import { preprocessingCache } from './PreprocessingCache.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { prettyPrintRequestPayload } from '../agents/logging.js';
import path from 'path';
import { ExecutionTimeTracker } from '../utils/ExecutionTimeTracker.js';
import { getPreprocessingAgentDir } from './preprocessingAgentDir.js';
import type { AgentsPreprocessingModel, OpenAIConfig } from '../loaders/ConfigLoader.js';
import { getOpenAiResourceProvider } from '../runtime/resourceProvider.js';

const _dir = getPreprocessingAgentDir();

export function resolvePreprocessingModelName(config: OpenAIConfig): string {
  const name = config.preprocessingModel?.name ?? config.defaultModel?.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error(
      'Preprocessing requires openai.json `preprocessingModel.name` and/or `defaultModel.name` to be set.'
    );
  }
  return name;
}

/** Resolved API params for CV + job-description preprocessing (shared). */
export interface ResolvedPreprocessingParams {
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

/**
 * When `agents.preprocessing.name` is non-empty, it wins; otherwise use openai.json preprocessingModel / defaultModel.
 */
export function resolvePreprocessingParams(
  agentsPreprocessing: AgentsPreprocessingModel | undefined,
  openai: OpenAIConfig
): ResolvedPreprocessingParams {
  const fromAgents = agentsPreprocessing?.name?.trim();
  if (fromAgents) {
    return {
      model: fromAgents,
      temperature:
        agentsPreprocessing!.temperature ??
        openai.preprocessingModel?.temperature ??
        openai.defaultModel?.temperature ??
        0.2,
      maxOutputTokens:
        agentsPreprocessing!.max_tokens ??
        openai.preprocessingModel?.maxTokens ??
        openai.defaultModel?.maxTokens ??
        8000,
    };
  }
  return {
    model: resolvePreprocessingModelName(openai),
    temperature: openai.preprocessingModel?.temperature ?? openai.defaultModel?.temperature ?? 0.2,
    maxOutputTokens: openai.preprocessingModel?.maxTokens ?? openai.defaultModel?.maxTokens ?? 8000,
  };
}

/** CV extractor prompt version and filename for diagnostics and cache invalidation */
export const CV_EXTRACTOR_PROMPT_VERSION = '1.2.2';
export const CV_EXTRACTOR_PROMPT_FILE = 'cv_extractor.v1.2.3.yaml';

/**
 * Count experience entries from structured CV. Supports both legacy (top-level experience array)
 * and sections-based shape (section with kind "experience" and content.items).
 */
function getExperienceCount(structuredCV: unknown): number {
  if (!structuredCV || typeof structuredCV !== 'object') return 0;
  const cv = structuredCV as Record<string, unknown>;
  if (Array.isArray(cv.experience)) return cv.experience.length;
  const sections = cv.sections;
  if (!Array.isArray(sections)) return 0;
  const experienceSection = sections.find(
    (s: unknown) =>
      typeof s === 'object' && s !== null && (s as Record<string, unknown>).kind === 'experience'
  );
  if (!experienceSection || typeof experienceSection !== 'object') return 0;
  const content = (experienceSection as Record<string, unknown>).content as Record<string, unknown> | undefined;
  const items = content && Array.isArray(content.items) ? content.items : [];
  return items.length;
}

async function writePreprocessingRequestLogFile(
  agentName: string,
  stageName: string,
  runId: string | null,
  metadata: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const now = new Date();
    let dateStr: string;
    let timeStr: string;
    if (runId) {
      if (runId.includes('T')) {
        const parts = runId.split('T');
        dateStr = parts[0];
        timeStr = parts[1];
      } else {
        dateStr = now.toISOString().split('T')[0];
        timeStr = runId;
      }
    } else {
      dateStr = now.toISOString().split('T')[0];
      timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    }

    const logsBaseDir = path.resolve(_dir, '../../../logs');
    const requestsDir = path.join(logsBaseDir, dateStr, timeStr, 'requests');
    await mkdir(requestsDir, { recursive: true });

    const sanitizedAgentName = agentName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedStageName = stageName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedAgentName}_${sanitizedStageName}_${timestamp}_request.json`;
    const filePath = path.join(requestsDir, filename);

    const logContent = {
      agentName,
      stageName,
      type: 'request',
      timestamp: now.toISOString(),
      runId: runId || null,
      metadata,
      payload: prettyPrintRequestPayload(payload),
    };

    await writeFile(filePath, JSON.stringify(logContent, null, 2), 'utf-8');
  } catch (error) {
    Logger.warn('PreprocessingAgent', 'Failed to write preprocessing request log file', {
      agentName,
      stageName,
      error: (error as Error).message,
    });
  }
}

/**
 * CV Extractor Agent - extracts structured CV data from unstructured CV (raw text).
 * Uses a well-formed JSON prompt object (same shape as pipeline agents) for instructions.
 */
export class CVExtractorAgent {
  private promptObject: Record<string, unknown> = {};
  private commonFragments: Awaited<ReturnType<typeof loadCommonPromptFragments>> | null = null;

  async init(_unstructuredCVText: string): Promise<void> {
    const promptPath = path.resolve(_dir, '../../../prompts/preprocessing', CV_EXTRACTOR_PROMPT_FILE);
    const provider = getOpenAiResourceProvider();
    const rawContent =
      (await provider?.getPromptText?.(`preprocessing/${CV_EXTRACTOR_PROMPT_FILE}`)) ??
      (await readFile(promptPath, 'utf-8'));
    const { promptObject: parsedObject } = parsePromptYamlToObject(rawContent);
    this.promptObject = { ...parsedObject };
    const agentBuilderDir = path.resolve(_dir, '../agents');
    this.commonFragments = await loadCommonPromptFragments(agentBuilderDir);
  }

  /**
   * Extract structured CV from unstructured CV (raw text).
   */
  async extract(
    unstructuredCVText: string,
    runId: string | null = null,
    tracker?: ExecutionTimeTracker,
    options?: { selectedMissingSkills?: string[]; preprocessingParams?: ResolvedPreprocessingParams }
  ): Promise<ExtractResult<StructuredCV>> {
    if (Object.keys(this.promptObject).length === 0) {
      await this.init(unstructuredCVText);
    }

    const client = getOpenAIClient();
    const config = getOpenAIConfig();
    const params =
      options?.preprocessingParams ?? resolvePreprocessingParams(undefined, config);
    const resolvedTracker = tracker ?? ExecutionTimeTracker.getInstance();

    // Convert Zod schema to JSON Schema (from registry)
    const cvSchema = getSchema('optimized_structured_cv');
    let jsonSchema: any = zodToJsonSchema(cvSchema as any, {
      name: 'StructuredCV',
      target: 'openApi3',
    });

    // Handle $ref if present
    if ((jsonSchema as any).$ref) {
      const refPath = (jsonSchema as any).$ref;
      if (refPath.includes('#/definitions/')) {
        const refName = refPath.replace('#/definitions/', '');
        if ((jsonSchema as any).definitions && (jsonSchema as any).definitions[refName]) {
          jsonSchema = JSON.parse(JSON.stringify((jsonSchema as any).definitions[refName]));
        }
      } else if (refPath.includes('#/$defs/')) {
        const refName = refPath.replace('#/$defs/', '');
        if ((jsonSchema as any).$defs && (jsonSchema as any).$defs[refName]) {
          jsonSchema = JSON.parse(JSON.stringify((jsonSchema as any).$defs[refName]));
        }
      }
    }

    // Ensure type is object
    if (!jsonSchema.type || jsonSchema.type === 'None' || jsonSchema.type === null || jsonSchema.type === undefined) {
      jsonSchema.type = 'object';
    }

    // Remove $ref if it still exists
    if ((jsonSchema as any).$ref) {
      delete (jsonSchema as any).$ref;
    }
    if ((jsonSchema as any).definitions) {
      delete (jsonSchema as any).definitions;
    }
    if ((jsonSchema as any).$defs) {
      delete (jsonSchema as any).$defs;
    }

    // Fix additionalProperties for Responses API and ensure required fields
    const fixSchema = (schema: any): void => {
      if (!schema || typeof schema !== 'object') return;
      
      // Fix additionalProperties
      if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
        if (typeof schema.additionalProperties === 'object' || schema.additionalProperties === true) {
          schema.additionalProperties = false;
        }
      }
      if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length > 0) {
        schema.additionalProperties = false;
      }
      
      // Ensure required array exists and includes all properties (Responses API requirement)
      if (schema.type === 'object' && schema.properties) {
        const propertyNames = Object.keys(schema.properties);
        if (propertyNames.length > 0) {
          if (!schema.required) {
            schema.required = [];
          }
          const requiredSet = new Set(schema.required);
          const missingFromRequired = propertyNames.filter(name => !requiredSet.has(name));
          if (missingFromRequired.length > 0) {
            schema.required = [...schema.required, ...missingFromRequired];
          }
        }
      }
      
      // Recursively fix nested schemas
      if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
          fixSchema(schema.properties[propName]);
        }
      }
      if (schema.items) {
        fixSchema(schema.items);
      }
      if (schema.anyOf && Array.isArray(schema.anyOf)) {
        schema.anyOf.forEach((subSchema: any) => fixSchema(subSchema));
      }
      if (schema.oneOf && Array.isArray(schema.oneOf)) {
        schema.oneOf.forEach((subSchema: any) => fixSchema(subSchema));
      }
    };
    fixSchema(jsonSchema);

    // Build input context (unstructured CV = raw text input). For reruns, include
    // user-selected missing skills so extractor can incorporate them into structured skills output.
    const selectedMissingSkills = options?.selectedMissingSkills;
    const normalizedSelectedMissingSkills = Array.isArray(selectedMissingSkills)
      ? selectedMissingSkills
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0)
      : [];
    const inputPayload = {
      input_data: {
        unstructured_cv: unstructuredCVText,
        selected_missing_skills: normalizedSelectedMissingSkills,
      },
      instruction: 'Respond with valid JSON only.',
    };

    // Well-formed JSON prompt object: system + prompt sections + json_output_format
    const systemMessage = config.systemMessage ?? 'You are an expert data extraction specialist. You MUST respond with valid JSON only, no additional text before or after the JSON object.';
    const mergedPromptObject: Record<string, unknown> = { system: systemMessage, ...this.promptObject };
    if (this.commonFragments?.jsonOutputFormat?.trim() && !('json_output_format' in mergedPromptObject)) {
      mergedPromptObject.json_output_format = this.commonFragments.jsonOutputFormat.trim();
    }
    replaceNewlinesInStrings(mergedPromptObject);
    const instructions = JSON.stringify(mergedPromptObject);
    const input = JSON.stringify(inputPayload);

    Logger.debug('CVExtractorAgent', 'Extracting structured CV', {
      cvSize: unstructuredCVText.length,
      promptKeys: Object.keys(mergedPromptObject),
    });

    const apiStartTime = Date.now();
    const { model, temperature, maxOutputTokens } = params;
    const requestParams: Record<string, unknown> = {
      model: model,
      input: input,
      instructions: instructions,
      text: {
        format: {
          type: 'json_schema',
          name: 'StructuredCV',
          schema: jsonSchema,
          strict: false,
        },
      },
      max_output_tokens: maxOutputTokens,
      temperature: temperature,
    };

    try {
      await writePreprocessingRequestLogFile(
        'CV Extractor',
        'preprocessing_cv',
        runId,
        {
          model,
          maxOutputTokens,
          temperature,
          responseFormat: 'json_schema',
          strictMode: false,
        },
        requestParams
      );
      const response = await (client as any).responses.create(requestParams);

      const apiEndTime = Date.now();
      
      // Record successful API request timing
      resolvedTracker.recordOpenAIRequest(
        'CV Extractor',
        'preprocessing_cv',
        model,
        apiStartTime,
        apiEndTime,
        true
      );

      // Extract structured data from response
      let parsed: unknown;
      
      // Log response structure for debugging
      Logger.debug('CVExtractorAgent', 'Response received', {
        outputType: typeof response.output,
        isArray: Array.isArray(response.output),
        isNull: response.output === null,
        outputPreview: response.output ? JSON.stringify(response.output).substring(0, 200) : 'null',
      });
      
      if (response.output === null || response.output === undefined) {
        throw new Error('Response output is null or undefined');
      } else if (typeof response.output === 'object' && !Array.isArray(response.output)) {
        parsed = response.output;
      } else if (Array.isArray(response.output)) {
        if (response.output.length === 0) {
          throw new Error('Response output is an empty array');
        }
        // Handle array response - check if it's a simple array or complex structure
        const firstItem = response.output[0];
        if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
          // Check if it's a message structure (like AgentBuilder handles)
          if ('type' in firstItem && firstItem.type === 'message' && 'content' in firstItem) {
            const messageObj = firstItem as any;
            const outputTextItem = Array.isArray(messageObj.content) 
              ? messageObj.content.find((item: any) => item.type === 'output_text')
              : null;
            if (outputTextItem && outputTextItem.text) {
              parsed = typeof outputTextItem.text === 'string' 
                ? JSON.parse(outputTextItem.text) 
                : outputTextItem.text;
            } else {
              // Fallback: use first item directly
              parsed = firstItem;
            }
          } else {
            // Simple array - use first element
            parsed = firstItem;
          }
        } else {
          parsed = firstItem;
        }
      } else if (typeof response.output === 'string') {
        parsed = JSON.parse(response.output);
      } else {
        Logger.error('CVExtractorAgent', 'Unexpected response format', new Error('Response output type check failed'), {
          outputType: typeof response.output,
          isArray: Array.isArray(response.output),
          output: JSON.stringify(response.output).substring(0, 500),
        });
        throw new Error(`Unexpected response.output type: ${typeof response.output}`);
      }

      // Validate against schema
      const validated = getSchema('optimized_structured_cv').parse(parsed);
      const tokenUsage = response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            model,
          }
        : undefined;
      return { data: validated, tokenUsage };
    } catch (error) {
      const apiEndTime = Date.now();
      
      // Record failed API request timing
      resolvedTracker.recordOpenAIRequest(
        'CV Extractor',
        'preprocessing_cv',
        params.model,
        apiStartTime,
        apiEndTime,
        false,
        undefined,
        undefined,
        (error as Error).message
      );
      
      Logger.error('CVExtractorAgent', 'Failed to extract structured CV', error as Error);
      throw error;
    }
  }
}

/**
 * Job Description Extractor Agent - extracts structured job description data from raw text.
 * Uses a well-formed JSON prompt object (same shape as pipeline agents) for instructions.
 */
export class JobDescriptionExtractorAgent {
  private promptObject: Record<string, unknown> = {};
  private commonFragments: Awaited<ReturnType<typeof loadCommonPromptFragments>> | null = null;

  private normalizeForCompare(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[“”‘’]/g, "'")
      .replace(/[^\w\s'()-]/g, '')
      .trim();
  }

  private dedupeAdditionalSections(validated: StructuredJobDescription): StructuredJobDescription {
    const additional = validated.additional_sections ?? [];
    if (additional.length === 0) return validated;

    const bannedSectionNamePatterns: RegExp[] = [
      /about\s+the\s+job/i,
      /about\s+this\s+role/i,
      /what\s+you[’']?ll\s+do/i,
      /what\s+we[’']?re\s+looking\s+for/i,
      /requirements/i,
      /must\s+have/i,
      /nice\s+to\s+have/i,
      /preferred/i,
      /responsibilit/i,
      /duties/i,
      /overview/i,
      /summary/i,
    ];

    const normalizedSummary = validated.summary ? this.normalizeForCompare(validated.summary) : '';
    const responsibilitySet = new Set((validated.responsibilities ?? []).map(r => this.normalizeForCompare(r)));

    const filtered = additional.filter((section) => {
      const name = section.section_name ?? '';
      if (bannedSectionNamePatterns.some((re) => re.test(name))) {
        return false;
      }

      const content = section.content;
      // Drop if content is literally empty or trivial placeholder
      if (typeof content === 'string') {
        const normalizedContent = this.normalizeForCompare(content);
        if (!normalizedContent || normalizedContent === this.normalizeForCompare(name)) return false;
        // Drop if it duplicates the summary (contains or equals)
        if (normalizedSummary && (normalizedContent === normalizedSummary || normalizedContent.includes(normalizedSummary))) {
          return false;
        }
      }

      // Drop if array content substantially overlaps responsibilities
      if (Array.isArray(content) && responsibilitySet.size > 0) {
        const normalizedItems = content
          .filter((x): x is string => typeof x === 'string')
          .map((x) => this.normalizeForCompare(x))
          .filter(Boolean);
        if (normalizedItems.length > 0) {
          const overlapCount = normalizedItems.reduce((sum, item) => sum + (responsibilitySet.has(item) ? 1 : 0), 0);
          const overlapRatio = overlapCount / normalizedItems.length;
          if (overlapRatio >= 0.5) {
            return false;
          }
        }
      }

      return true;
    });

    if (filtered.length === additional.length) return validated;
    return {
      ...validated,
      additional_sections: filtered.length > 0 ? filtered : undefined,
    };
  }

  async init(_unstructuredJobDescriptionText: string): Promise<void> {
    const promptPath = path.resolve(_dir, '../../../prompts/preprocessing/job_description_extractor.v1.1.1.yaml');
    const provider = getOpenAiResourceProvider();
    const rawContent =
      (await provider?.getPromptText?.('preprocessing/job_description_extractor.v1.1.1.yaml')) ??
      (await readFile(promptPath, 'utf-8'));
    const { promptObject: parsedObject } = parsePromptYamlToObject(rawContent);
    this.promptObject = { ...parsedObject };
    const agentBuilderDir = path.resolve(_dir, '../agents');
    this.commonFragments = await loadCommonPromptFragments(agentBuilderDir);
  }

  /**
   * Extract structured job description from unstructured job description (raw text).
   */
  async extract(
    unstructuredJobDescriptionText: string,
    runId: string | null = null,
    tracker?: ExecutionTimeTracker,
    options?: { preprocessingParams?: ResolvedPreprocessingParams }
  ): Promise<ExtractResult<StructuredJobDescription>> {
    if (Object.keys(this.promptObject).length === 0) {
      await this.init(unstructuredJobDescriptionText);
    }

    const client = getOpenAIClient();
    const resolvedTracker = tracker ?? ExecutionTimeTracker.getInstance();
    const config = getOpenAIConfig();
    const params =
      options?.preprocessingParams ?? resolvePreprocessingParams(undefined, config);

    // Convert Zod schema to JSON Schema (from registry)
    const jdSchema = getSchema('structured_job_description');
    let jsonSchema: any = zodToJsonSchema(jdSchema as any, {
      name: 'StructuredJobDescription',
      target: 'openApi3',
    });

    // Handle $ref if present
    if ((jsonSchema as any).$ref) {
      const refPath = (jsonSchema as any).$ref;
      if (refPath.includes('#/definitions/')) {
        const refName = refPath.replace('#/definitions/', '');
        if ((jsonSchema as any).definitions && (jsonSchema as any).definitions[refName]) {
          jsonSchema = JSON.parse(JSON.stringify((jsonSchema as any).definitions[refName]));
        }
      } else if (refPath.includes('#/$defs/')) {
        const refName = refPath.replace('#/$defs/', '');
        if ((jsonSchema as any).$defs && (jsonSchema as any).$defs[refName]) {
          jsonSchema = JSON.parse(JSON.stringify((jsonSchema as any).$defs[refName]));
        }
      }
    }

    // Ensure type is object
    if (!jsonSchema.type || jsonSchema.type === 'None' || jsonSchema.type === null || jsonSchema.type === undefined) {
      jsonSchema.type = 'object';
    }

    // Remove $ref if it still exists
    if ((jsonSchema as any).$ref) {
      delete (jsonSchema as any).$ref;
    }
    if ((jsonSchema as any).definitions) {
      delete (jsonSchema as any).definitions;
    }
    if ((jsonSchema as any).$defs) {
      delete (jsonSchema as any).$defs;
    }

    // Fix additionalProperties for Responses API and ensure required fields
    const fixSchema = (schema: any): void => {
      if (!schema || typeof schema !== 'object') return;
      
      // Fix additionalProperties
      if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
        if (typeof schema.additionalProperties === 'object' || schema.additionalProperties === true) {
          schema.additionalProperties = false;
        }
      }
      if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length > 0) {
        schema.additionalProperties = false;
      }
      
      // Ensure required array exists and includes all properties (Responses API requirement)
      if (schema.type === 'object' && schema.properties) {
        const propertyNames = Object.keys(schema.properties);
        if (propertyNames.length > 0) {
          if (!schema.required) {
            schema.required = [];
          }
          const requiredSet = new Set(schema.required);
          const missingFromRequired = propertyNames.filter(name => !requiredSet.has(name));
          if (missingFromRequired.length > 0) {
            schema.required = [...schema.required, ...missingFromRequired];
          }
        }
      }
      
      // Recursively fix nested schemas
      if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
          fixSchema(schema.properties[propName]);
        }
      }
      if (schema.items) {
        fixSchema(schema.items);
      }
      if (schema.anyOf && Array.isArray(schema.anyOf)) {
        schema.anyOf.forEach((subSchema: any) => fixSchema(subSchema));
      }
      if (schema.oneOf && Array.isArray(schema.oneOf)) {
        schema.oneOf.forEach((subSchema: any) => fixSchema(subSchema));
      }
    };
    fixSchema(jsonSchema);

    // Build input context (unstructured job description = raw text input)
    const inputContext = `## Input Data:\n\n### Unstructured job description:\n${unstructuredJobDescriptionText}\n\n`;

    // Well-formed JSON prompt object: system + prompt sections + json_output_format
    const systemMessage = config.systemMessage ?? 'You are an expert data extraction specialist. You MUST respond with valid JSON only, no additional text before or after the JSON object.';
    const mergedPromptObject: Record<string, unknown> = { system: systemMessage, ...this.promptObject };
    if (this.commonFragments?.jsonOutputFormat?.trim() && !('json_output_format' in mergedPromptObject)) {
      mergedPromptObject.json_output_format = this.commonFragments.jsonOutputFormat.trim();
    }
    replaceNewlinesInStrings(mergedPromptObject);
    const instructions = JSON.stringify(mergedPromptObject);
    const input = inputContext + '\n\nIMPORTANT: Respond with valid JSON only.';

    Logger.debug('JobDescriptionExtractorAgent', 'Extracting structured job description', {
      jobDescriptionSize: unstructuredJobDescriptionText.length,
      promptKeys: Object.keys(mergedPromptObject),
    });

    const apiStartTime = Date.now();
    const { model, temperature, maxOutputTokens } = params;
    const requestParams: Record<string, unknown> = {
      model: model,
      input: input,
      instructions: instructions,
      text: {
        format: {
          type: 'json_schema',
          name: 'StructuredJobDescription',
          schema: jsonSchema,
          strict: false,
        },
      },
      max_output_tokens: maxOutputTokens,
      temperature: temperature,
    };

    try {
      await writePreprocessingRequestLogFile(
        'Job Description Extractor',
        'preprocessing_job_description',
        runId,
        {
          model,
          maxOutputTokens,
          temperature,
          responseFormat: 'json_schema',
          strictMode: false,
        },
        requestParams
      );
      const response = await (client as any).responses.create(requestParams);

      const apiEndTime = Date.now();
      
      // Record successful API request timing
      resolvedTracker.recordOpenAIRequest(
        'Job Description Extractor',
        'preprocessing_job_description',
        model,
        apiStartTime,
        apiEndTime,
        true
      );

      // Extract structured data from response
      let parsed: unknown;
      
      // Log response structure for debugging
      Logger.debug('JobDescriptionExtractorAgent', 'Response received', {
        outputType: typeof response.output,
        isArray: Array.isArray(response.output),
        isNull: response.output === null,
        outputPreview: response.output ? JSON.stringify(response.output).substring(0, 200) : 'null',
      });
      
      if (response.output === null || response.output === undefined) {
        throw new Error('Response output is null or undefined');
      } else if (typeof response.output === 'object' && !Array.isArray(response.output)) {
        parsed = response.output;
      } else if (Array.isArray(response.output)) {
        if (response.output.length === 0) {
          throw new Error('Response output is an empty array');
        }
        // Handle array response - check if it's a simple array or complex structure
        const firstItem = response.output[0];
        if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
          // Check if it's a message structure (like AgentBuilder handles)
          if ('type' in firstItem && firstItem.type === 'message' && 'content' in firstItem) {
            const messageObj = firstItem as any;
            const outputTextItem = Array.isArray(messageObj.content) 
              ? messageObj.content.find((item: any) => item.type === 'output_text')
              : null;
            if (outputTextItem && outputTextItem.text) {
              parsed = typeof outputTextItem.text === 'string' 
                ? JSON.parse(outputTextItem.text) 
                : outputTextItem.text;
            } else {
              // Fallback: use first item directly
              parsed = firstItem;
            }
          } else {
            // Simple array - use first element
            parsed = firstItem;
          }
        } else {
          parsed = firstItem;
        }
      } else if (typeof response.output === 'string') {
        parsed = JSON.parse(response.output);
      } else {
        Logger.error('JobDescriptionExtractorAgent', 'Unexpected response format', new Error('Response output type check failed'), {
          outputType: typeof response.output,
          isArray: Array.isArray(response.output),
          output: JSON.stringify(response.output).substring(0, 500),
        });
        throw new Error(`Unexpected response.output type: ${typeof response.output}`);
      }

      // Validate against schema
      const validated = getSchema('structured_job_description').parse(parsed);
      const data = this.dedupeAdditionalSections(validated);
      const tokenUsage = response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            model,
          }
        : undefined;
      return { data, tokenUsage };
    } catch (error) {
      const apiEndTime = Date.now();
      
      // Record failed API request timing
      resolvedTracker.recordOpenAIRequest(
        'Job Description Extractor',
        'preprocessing_job_description',
        params.model,
        apiStartTime,
        apiEndTime,
        false,
        undefined,
        undefined,
        (error as Error).message
      );
      
      Logger.error('JobDescriptionExtractorAgent', 'Failed to extract structured job description', error as Error);
      throw error;
    }
  }
}

/** Token usage from a preprocessing API call. */
export interface PreprocessingTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Model id used for this usage (same as CV/JD extractors when combined). */
  model?: string;
}

/** Result of a single extract call (CV or job description). */
export interface ExtractResult<T> {
  data: T;
  tokenUsage?: PreprocessingTokenUsage;
}

/**
 * Fallback: fill contact.phone, contact.location, and optionally title from unstructured CV header
 * when the extractor left them empty. Uses the first ~1200 chars (typical header region).
 * Mutates structuredCV in place.
 */
function fillHeaderFromUnstructuredCv(unstructuredCVText: string, structuredCV: StructuredCV): void {
  if (!unstructuredCVText || typeof structuredCV !== 'object') return;
  const headerRegion = unstructuredCVText.slice(0, 1200);

  if (!structuredCV.header) {
    (structuredCV as Record<string, unknown>).header = {};
  }
  const header = structuredCV.header as Record<string, unknown>;
  let contact = header.contact as Record<string, string> | undefined;
  const needPhone = !contact?.phone?.trim();
  const needLocation = !contact?.location?.trim();
  const needTitle = !(header.professional_title as string)?.trim();

  if (needPhone || needLocation) {
    if (!contact || typeof contact !== 'object') {
      contact = {};
      header.contact = contact;
    }
    // Phone: UK style +44 (0) 7788 926921 or similar, or generic +digits / digit groups
    if (needPhone) {
      const ukPhone = headerRegion.match(/\+44\s*\(?\s*0\s*\)?\s*[\d\s]{10,}/)?.[0]?.trim()
        ?? headerRegion.match(/\+44\s*[\d\s]{10,}/)?.[0]?.trim()
        ?? headerRegion.match(/\(?\s*0\s*\)?\s*[\d\s\-]{10,}/)?.[0]?.trim();
      const genericPhone = headerRegion.match(/\+[\d\s\-\(\)]{10,}/)?.[0]?.trim();
      const found = (ukPhone ?? genericPhone)?.replace(/\s+/g, ' ').trim();
      if (found && found.length >= 10) {
        contact.phone = found;
      }
    }
    // Location: United Kingdom, UK, or common country/city names in header
    if (needLocation) {
      const ukMatch = headerRegion.match(/\b(United Kingdom|UK)\b/i)?.[1];
      const locationMatch = headerRegion.match(/\b(United (?:Kingdom|States)|UK|USA|England|Scotland|Wales|London|Manchester|Birmingham)\b/i)?.[1];
      const found = ukMatch ?? locationMatch;
      if (found) {
        contact.location = found;
      }
    }
  }

  // Title: often the second non-empty line (headline under name), if it doesn't look like email/phone
  if (needTitle) {
    const lines = headerRegion.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const secondLine = lines[1];
    if (secondLine && secondLine.length > 5 && !secondLine.includes('@') && !/^[\d\s\-+\(\)]+$/.test(secondLine)) {
      header.professional_title = secondLine.slice(0, 200);
    }
  }
}

/**
 * Preprocessing result interface
 */
export interface PreprocessingResult {
  structured_cv: StructuredCV;
  structured_job_description: StructuredJobDescription;
  tokenUsage?: PreprocessingTokenUsage;
}

/**
 * Write preprocessing results to log file with date/time folder structure
 * Uses runId if available, otherwise falls back to current timestamp
 * Exported so rerun path can write structured_cv (from optimized_cv) to the same run folder.
 */
export async function writePreprocessingLogFile(
  content: any,
  type: 'cv' | 'job_description',
  runId: string | null,
  metadata?: Record<string, any>
): Promise<string> {
  try {
    const now = new Date();
    
    // Use runId if provided, otherwise use current timestamp
    let dateStr: string;
    let timeStr: string;
    if (runId) {
      // Extract date and time from runId (format: YYYY-MM-DDTHH-MM-SS)
      if (runId.includes('T')) {
        const parts = runId.split('T');
        dateStr = parts[0]; // YYYY-MM-DD
        timeStr = parts[1]; // HH-MM-SS (already has colons replaced)
      } else {
        // Fallback: runId is just time string, use current date
        dateStr = now.toISOString().split('T')[0];
        timeStr = runId;
      }
    } else {
      // No runId: use current timestamp
      dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS
    }
    
    // Create folder structure: logs/YYYY-MM-DD/HH-MM-SS/ (same as agent logs)
    // Write preprocessing files directly to timeDir, same folder as requests/responses subdirectories
    const logsBaseDir = path.resolve(_dir, '../../../logs');
    const dateDir = path.join(logsBaseDir, dateStr);
    const timeDir = path.join(dateDir, timeStr);
    
    // Create directories recursively
    // Check if directory exists before creating (faster for subsequent writes)
    // Directory might already exist from another agent - that's fine
    try {
      await mkdir(timeDir, { recursive: true });
    } catch (mkdirError) {
      // Directory might already exist from another agent - that's fine
      if ((mkdirError as any).code !== 'EEXIST') {
        throw mkdirError;
      }
    }
    
    // Create filename: structured_cv_timestamp.json or structured_job_description_timestamp.json
    // Write directly to timeDir (same folder as requests/ and responses/ subdirectories)
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `structured_${type}_${timestamp}.json`;
    const filePath = path.join(timeDir, filename);
    
    // Prepare log content
    const logContent = {
      type: `structured_${type}`,
      timestamp: now.toISOString(),
      runId: runId || null,
      metadata: metadata || {},
      content: content,
    };
    
    // Write file
    await writeFile(filePath, JSON.stringify(logContent, null, 2), 'utf-8');
    
    Logger.debug('PreprocessingAgent', `Logged structured ${type} to file`, {
      type,
      filePath,
      contentSize: JSON.stringify(content).length,
      runId: runId || 'none',
    });
    
    return filePath;
  } catch (error) {
    // Don't throw - logging failures shouldn't break the main flow
    Logger.warn('PreprocessingAgent', `Failed to write preprocessing log file for ${type}`, {
      type,
      error: (error as Error).message,
    });
    return '';
  }
}

/**
 * Preprocess job description only (e.g. for rerun when structured_cv comes from optimized_cv).
 * Does not use the full preprocessing cache (keyed by CV+job); rerun is typically one-off.
 */
/**
 * Preprocess unstructured job description only (e.g. for rerun when structured_cv comes from optimized_cv).
 */
export async function preprocessJobDescriptionOnly(
  unstructuredJobDescriptionText: string,
  runId: string | null = null,
  tracker?: ExecutionTimeTracker,
  preprocessingParams?: ResolvedPreprocessingParams
): Promise<{ data: StructuredJobDescription; tokenUsage?: PreprocessingTokenUsage }> {
  const openai = getOpenAIConfig();
  const params = preprocessingParams ?? resolvePreprocessingParams(undefined, openai);
  const preprocessingModelName = params.model;
  Logger.info('Preprocessing', 'Starting job-description-only preprocessing (rerun)', {
    jobDescriptionSize: unstructuredJobDescriptionText.length,
  });
  const jobExtractor = new JobDescriptionExtractorAgent();
  await jobExtractor.init(unstructuredJobDescriptionText);
  const result = await jobExtractor.extract(unstructuredJobDescriptionText, runId, tracker, {
    preprocessingParams: params,
  });
  await writePreprocessingLogFile(
    result.data,
    'job_description',
    runId,
    { rawJobDescriptionSize: unstructuredJobDescriptionText.length, model: preprocessingModelName, jobOnly: true }
  );
  return { data: result.data, tokenUsage: result.tokenUsage };
}

/**
 * Preprocess unstructured CV only (rerun path: edited CV text + selected missing skills).
 */
export async function preprocessCVOnly(
  unstructuredCVText: string,
  runId: string | null = null,
  tracker?: ExecutionTimeTracker,
  options?: { selectedMissingSkills?: string[]; preprocessingParams?: ResolvedPreprocessingParams }
): Promise<{ data: StructuredCV; tokenUsage?: PreprocessingTokenUsage }> {
  const selectedMissingSkills = options?.selectedMissingSkills;
  const openai = getOpenAIConfig();
  const params = options?.preprocessingParams ?? resolvePreprocessingParams(undefined, openai);
  const preprocessingModelName = params.model;
  Logger.info('Preprocessing', 'Starting CV-only preprocessing (rerun)', {
    cvSize: unstructuredCVText.length,
    selectedMissingSkillsCount: Array.isArray(selectedMissingSkills) ? selectedMissingSkills.length : 0,
  });
  const cvExtractor = new CVExtractorAgent();
  await cvExtractor.init(unstructuredCVText);
  const result = await cvExtractor.extract(unstructuredCVText, runId, tracker, {
    selectedMissingSkills,
    preprocessingParams: params,
  });
  await writePreprocessingLogFile(
    result.data,
    'cv',
    runId,
    {
      rawCVSize: unstructuredCVText.length,
      model: preprocessingModelName,
      cvOnly: true,
      selectedMissingSkillsCount: Array.isArray(selectedMissingSkills) ? selectedMissingSkills.length : 0,
    }
  );
  return { data: result.data, tokenUsage: result.tokenUsage };
}

/**
 * Main preprocessing: extract structured CV and structured job description from unstructured CV and unstructured job description (raw text).
 * Uses caching unless skipCache is true or PREPROCESSING_SKIP_CACHE=1.
 */
export async function preprocessInputs(
  unstructuredCVText: string,
  unstructuredJobDescriptionText: string,
  runId: string | null = null,
  options?: { skipCache?: boolean; preprocessingParams?: ResolvedPreprocessingParams },
  tracker?: ExecutionTimeTracker
): Promise<PreprocessingResult> {
  const preprocessingStartTime = Date.now();
  const skipCache =
    options?.skipCache === true ||
    process.env.PREPROCESSING_SKIP_CACHE === '1' ||
    process.env.PREPROCESSING_SKIP_CACHE === 'true';

  Logger.info('Preprocessing', 'Starting preprocessing', {
    cvSize: unstructuredCVText.length,
    jobDescriptionSize: unstructuredJobDescriptionText.length,
    skipCache,
  });

  const resolvedTracker = tracker ?? ExecutionTimeTracker.getInstance();
  const openaiForPreproc = getOpenAIConfig();
  const preprocessingParamsResolved =
    options?.preprocessingParams ?? resolvePreprocessingParams(undefined, openaiForPreproc);
  const preprocessingModelName = preprocessingParamsResolved.model;

  const cvStartTime = Date.now();
  const jobDescriptionStartTime = Date.now();

  // Check cache first unless bypass requested (include prompt versions to invalidate cache when prompts change)
  const cvPromptVersion = CV_EXTRACTOR_PROMPT_VERSION;
  const jobDescriptionPromptVersion = '1.1.1';
  const cacheKey = preprocessingCache.getDebugKey(unstructuredCVText, unstructuredJobDescriptionText, cvPromptVersion, jobDescriptionPromptVersion);
  Logger.debug('Preprocessing', 'Cache lookup', {
    cacheKeyPrefix: cacheKey.slice(0, 12),
    cvSize: unstructuredCVText.length,
    jobDescriptionSize: unstructuredJobDescriptionText.length,
    cvPromptVersion,
    jobDescriptionPromptVersion,
    skipCache,
  });
  const cached = skipCache ? null : preprocessingCache.get(unstructuredCVText, unstructuredJobDescriptionText, cvPromptVersion, jobDescriptionPromptVersion);
  if (cached) {
    const cachedExperienceCount = getExperienceCount(cached.structured_cv);
    Logger.info('Preprocessing', 'Using cached preprocessed data', {
      cacheKeyPrefix: cacheKey.slice(0, 12),
      cvSize: unstructuredCVText.length,
      jobDescriptionSize: unstructuredJobDescriptionText.length,
      cvPromptVersion,
      cvExtractorPromptFile: CV_EXTRACTOR_PROMPT_FILE,
      experienceCount: cachedExperienceCount,
    });
    
    const cvEndTime = Date.now();
    const jobDescriptionEndTime = Date.now();
    
    // Record cached preprocessing timing
    resolvedTracker.recordPreprocessing('cv', cvStartTime, cvEndTime, true);
    resolvedTracker.recordPreprocessing('jobDescription', jobDescriptionStartTime, jobDescriptionEndTime, true);
    
    // Still write cached results to log files
    await Promise.all([
      writePreprocessingLogFile(
        cached.structured_cv,
        'cv',
        runId,
        {
          rawCVSize: unstructuredCVText.length,
          model: preprocessingModelName,
          cached: true,
          cvPromptVersion,
          cvExtractorPromptFile: CV_EXTRACTOR_PROMPT_FILE,
          experienceCount: cachedExperienceCount,
        }
      ),
      writePreprocessingLogFile(
        cached.structured_job_description,
        'job_description',
        runId,
        {
          rawJobDescriptionSize: unstructuredJobDescriptionText.length,
          model: preprocessingModelName,
          cached: true,
        }
      ),
    ]);
    return cached;
  }

  Logger.debug('Preprocessing', 'Cache miss - running preprocessing extraction', {
    cacheKeyPrefix: cacheKey.slice(0, 12),
    cvSize: unstructuredCVText.length,
    jobDescriptionSize: unstructuredJobDescriptionText.length,
  });

  try {
    if (!openaiForPreproc) {
      throw new Error('OpenAI not initialized. Call initializeOpenAI() first.');
    }

    // Create extractor agents
    const cvExtractor = new CVExtractorAgent();
    const jobExtractor = new JobDescriptionExtractorAgent();

    // Initialize both agents
    await Promise.all([
      cvExtractor.init(unstructuredCVText),
      jobExtractor.init(unstructuredJobDescriptionText),
    ]);

    // Extract in parallel
    const cvExtractStartTime = Date.now();
    const jobDescriptionExtractStartTime = Date.now();
    
    const [cvResult, jobResult] = await Promise.all([
      cvExtractor.extract(unstructuredCVText, runId, resolvedTracker, {
        preprocessingParams: preprocessingParamsResolved,
      }),
      jobExtractor.extract(unstructuredJobDescriptionText, runId, resolvedTracker, {
        preprocessingParams: preprocessingParamsResolved,
      }),
    ]);
    const structuredCV = cvResult.data;
    const structuredJobDescription = jobResult.data;
    const tokenUsage =
      cvResult.tokenUsage && jobResult.tokenUsage
        ? {
            inputTokens: cvResult.tokenUsage.inputTokens + jobResult.tokenUsage.inputTokens,
            outputTokens: cvResult.tokenUsage.outputTokens + jobResult.tokenUsage.outputTokens,
            totalTokens: cvResult.tokenUsage.totalTokens + jobResult.tokenUsage.totalTokens,
            model: preprocessingModelName,
          }
        : undefined;

    const cvExtractEndTime = Date.now();
    const jobDescriptionExtractEndTime = Date.now();
    
    // Record preprocessing timing (overall extraction time, not just API call)
    resolvedTracker.recordPreprocessing('cv', cvExtractStartTime, cvExtractEndTime, false);
    resolvedTracker.recordPreprocessing('jobDescription', jobDescriptionExtractStartTime, jobDescriptionExtractEndTime, false);

    const experienceCount = getExperienceCount(structuredCV);

    // Truncation guard: flag suspiciously short experience output (e.g. legacy "last 4 roles" behaviour)
    const TRUNCATION_GUARD_THRESHOLD = 4;
    if (experienceCount <= TRUNCATION_GUARD_THRESHOLD) {
      Logger.warn('Preprocessing', 'CV experience count may indicate truncation', {
        runId: runId ?? 'none',
        experienceCount,
        threshold: TRUNCATION_GUARD_THRESHOLD,
        cvPromptVersion: CV_EXTRACTOR_PROMPT_VERSION,
        cvExtractorPromptFile: CV_EXTRACTOR_PROMPT_FILE,
        rawCVSize: unstructuredCVText.length,
      });
    }

    // Fallback: fill header (title, contact.phone, contact.location) from raw CV when extractor left them empty
    fillHeaderFromUnstructuredCv(unstructuredCVText, structuredCV);

    const result: PreprocessingResult = {
      structured_cv: structuredCV,
      structured_job_description: structuredJobDescription,
      tokenUsage,
    };

    // Cache the results unless bypass was requested (include prompt versions to invalidate cache when prompts change)
    const jobDescriptionPromptVersion = '1.1.1';
    if (!skipCache) {
      preprocessingCache.set(
        unstructuredCVText,
        unstructuredJobDescriptionText,
        structuredCV,
        structuredJobDescription,
        cvPromptVersion,
        jobDescriptionPromptVersion
      );
    } else {
      Logger.info('Preprocessing', 'Skipping cache write (skipCache=true)', {
        cvPromptVersion,
        experienceCount,
      });
    }

    const preprocessingLatency = Date.now() - preprocessingStartTime;
    Logger.info('Preprocessing', 'Preprocessing completed', {
      cvSize: unstructuredCVText.length,
      jobDescriptionSize: unstructuredJobDescriptionText.length,
      cvPromptVersion,
      cvExtractorPromptFile: CV_EXTRACTOR_PROMPT_FILE,
      experienceCount,
      cacheStats: preprocessingCache.getStats(),
    }, preprocessingLatency);

    // Write preprocessing results to log files
    await Promise.all([
      writePreprocessingLogFile(
        structuredCV,
        'cv',
        runId,
        {
          rawCVSize: unstructuredCVText.length,
          model: preprocessingModelName,
          cached: false,
          cvPromptVersion,
          cvExtractorPromptFile: CV_EXTRACTOR_PROMPT_FILE,
          experienceCount,
        }
      ),
      writePreprocessingLogFile(
        structuredJobDescription,
        'job_description',
        runId,
        {
          rawJobDescriptionSize: unstructuredJobDescriptionText.length,
          model: preprocessingModelName,
        }
      ),
    ]);

    return result;
  } catch (error) {
    Logger.error('Preprocessing', 'Preprocessing failed', error as Error, {
      cvSize: unstructuredCVText.length,
      jobDescriptionSize: unstructuredJobDescriptionText.length,
    });
    throw error;
  }
}
