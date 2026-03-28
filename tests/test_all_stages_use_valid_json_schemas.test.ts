/**
 * Ensures every stage agent uses a valid JSON schema:
 * - Every outputSchema in agents.json is registered in the schema registry.
 * - Each registered schema converts to valid JSON schema for the API.
 */
import { readFileSync } from 'fs';
import path from 'path';
import type { OutputSchemaName } from '../src/recruitment/agents/schemaRegistry.js';
import { getSchema } from '../src/recruitment/agents/schemaRegistry.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const CONFIG_PATH = path.resolve(__dirname, '../configs/agents.json');

describe('All stages use valid JSON schemas', () => {
  it('every outputSchema in agents.json is registered in the schema registry', () => {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{ id: string; agents: Array<{ outputSchema?: string }> }>;
    };
    const used = new Set<string>();
    for (const stage of config.stages) {
      for (const agent of stage.agents) {
        if (agent.outputSchema) used.add(agent.outputSchema);
      }
    }

    for (const schemaName of used) {
      const zodSchema = getSchema(schemaName as OutputSchemaName);
      expect(zodSchema).toBeDefined();
    }
  });

  it('every registered outputSchema converts to valid JSON schema (type object, has properties or valid structure)', () => {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as {
      stages: Array<{ agents: Array<{ outputSchema?: string }> }>;
    };
    const used = new Set<string>();
    for (const stage of config.stages) {
      for (const agent of stage.agents) {
        if (agent.outputSchema) used.add(agent.outputSchema);
      }
    }

    for (const schemaName of used) {
      const zodSchema = getSchema(schemaName as OutputSchemaName);
      const jsonSchema = zodToJsonSchema(zodSchema, {
        name: schemaName,
        target: 'openApi3',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type === 'object' || (jsonSchema as { $ref?: string }).$ref !== undefined).toBe(true);
    }
  });

  it('preprocessing schemas (optimized_structured_cv, structured_job_description) are registered and convert to JSON schema', () => {
    const preprocessingSchemas = ['optimized_structured_cv', 'structured_job_description'] as const;
    for (const schemaName of preprocessingSchemas) {
      const zodSchema = getSchema(schemaName);
      expect(zodSchema).toBeDefined();
      const jsonSchema = zodToJsonSchema(zodSchema!, {
        name: schemaName,
        target: 'openApi3',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      expect(jsonSchema).toBeDefined();
      expect(jsonSchema.type === 'object' || (jsonSchema as { $ref?: string }).$ref !== undefined).toBe(true);
    }
  });

});
