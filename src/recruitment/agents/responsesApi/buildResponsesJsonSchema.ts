import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Logger } from '../../utils/Logger.js';
import { enforceResponsesJsonSchemaConstraints } from '../normalizers/schemaConstraints.js';
import type { AgentConfig } from '../agentConfig.js';

export interface BuildResponsesJsonSchemaParams {
  zodSchema: ZodTypeAny;
  schemaName: string;
  agentName: string;
  stageName?: string;
  config: AgentConfig;
}

export interface BuildResponsesJsonSchemaResult {
  jsonSchema: Record<string, unknown>;
  useStrictMode: boolean;
}

/**
 * Convert agent Zod output schema to a Responses API-compatible JSON Schema (inlined refs, required keys, additionalProperties).
 */
export function buildResponsesJsonSchema({
  zodSchema,
  schemaName,
  agentName,
  stageName: _stageName,
  config: _config,
}: BuildResponsesJsonSchemaParams): BuildResponsesJsonSchemaResult {
// Convert Zod schema to JSON Schema for structured outputs.
// Use $refStrategy: "none" so all schemas are inlined; the API rejects $refs that point
// into definitions we strip (e.g. narrative anyOf string vs array of blocks; refs point at those).
let jsonSchema: any = zodToJsonSchema(zodSchema as any, {
  name: schemaName,
  target: 'openApi3',
  $refStrategy: 'none',
}) as any;

// Keep a full copy for $ref resolution; refs point into definitions so we need it before any extraction
const rootForRefs = JSON.parse(JSON.stringify(jsonSchema));

// If the schema has $ref, extract the actual schema from definitions
// The Responses API requires a direct object schema, not a reference
if (jsonSchema.$ref) {
  const refPath = jsonSchema.$ref;
  
  // Extract reference name from different possible formats
  if (refPath.includes('#/definitions/')) {
    const refName = refPath.replace('#/definitions/', '').split('/')[0];
    if (jsonSchema.definitions && jsonSchema.definitions[refName]) {
      // Extract the actual schema object from definitions (deep copy)
      jsonSchema = JSON.parse(JSON.stringify(jsonSchema.definitions[refName]));
    }
  } else if (refPath.includes('#/$defs/')) {
    const refName = refPath.replace('#/$defs/', '').split('/')[0];
    if (jsonSchema.$defs && jsonSchema.$defs[refName]) {
      // Extract the actual schema object from $defs (deep copy)
      jsonSchema = JSON.parse(JSON.stringify(jsonSchema.$defs[refName]));
    }
  }
  
  // If extraction failed, log warning
  if (jsonSchema.$ref) {
    Logger.warn('ResponsesSchema', `Failed to extract schema from $ref: ${refPath}`, {
      agentName,
      schemaName,
      hasDefinitions: !!jsonSchema.definitions,
      has$defs: !!jsonSchema.$defs,
    });
  }
}

// Ensure the schema has type: "object" (required by Responses API)
// This is critical - the API will reject schemas without explicit type: "object"
if (!jsonSchema.type || jsonSchema.type === 'None' || jsonSchema.type === null || jsonSchema.type === undefined) {
  jsonSchema.type = 'object';
}

// Remove $ref if it still exists (we've already extracted the actual schema)
if (jsonSchema.$ref) {
  delete jsonSchema.$ref;
}

// Resolve a JSON Pointer (#/definitions/... or #/... ) against root
const resolveRef = (root: any, ref: string): any => {
  if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  const path = ref.replace(/^#\//, '').split('/');
  let cur: any = root;
  for (const p of path) {
    cur = cur?.[p];
    if (cur === undefined) return undefined;
  }
  return cur;
};

// Recursively replace every $ref with a deep copy of the resolved schema so we can remove definitions
const inlineAllRefs = (obj: any, root: any, depth: number): void => {
  if (depth > 25 || obj == null || typeof obj !== 'object') return;
  if (obj.$ref && typeof obj.$ref === 'string') {
    const resolved = resolveRef(root, obj.$ref);
    if (resolved) {
      const copy = JSON.parse(JSON.stringify(resolved));
      Object.keys(obj).forEach((k) => delete obj[k]);
      Object.assign(obj, copy);
      inlineAllRefs(obj, root, depth + 1);
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item) => inlineAllRefs(item, root, depth + 1));
    return;
  }
  for (const key of Object.keys(obj)) {
    inlineAllRefs(obj[key], root, depth + 1);
  }
};

// Recursively inline all $ref so the API never sees broken refs (e.g. to definitions we remove).
// Use rootForRefs (full schema with definitions) so refs like #/definitions/.../items can be resolved.
inlineAllRefs(jsonSchema, rootForRefs, 0);

// Remove definitions/$defs after inlining so the API gets a flat schema
if (jsonSchema.definitions) {
  delete jsonSchema.definitions;
}
if (jsonSchema.$defs) {
  delete jsonSchema.$defs;
}

// Validate the final schema before sending
if (!jsonSchema.type || jsonSchema.type !== 'object') {
  Logger.error('ResponsesSchema', `Invalid schema type after processing: ${jsonSchema.type}`, undefined, {
    agentName,
    schemaName,
    schemaKeys: Object.keys(jsonSchema),
    schemaPreview: JSON.stringify(jsonSchema).substring(0, 200),
  });
  throw new Error(`Invalid schema type: expected "object", got "${jsonSchema.type}"`);
}

// Final validation: ensure all properties are in required array
// Responses API requires ALL properties to be in the 'required' array
if (jsonSchema.properties) {
  const propertyNames = Object.keys(jsonSchema.properties);
  
  // Ensure required array exists
  if (!jsonSchema.required) {
    jsonSchema.required = [];
  }
  
  const requiredSet = new Set(jsonSchema.required);
  const missingFromRequired = propertyNames.filter(name => !requiredSet.has(name));
  
  if (missingFromRequired.length > 0) {
    Logger.debug('ResponsesSchema', `Properties not in required array (will be added)`, {
      agentName,
      schemaName,
      missingProperties: missingFromRequired,
    });
    
    // ADD missing properties to required array (Responses API requirement)
    jsonSchema.required = [...jsonSchema.required, ...missingFromRequired];
  }

  // Responses API requires: required may only contain keys that exist in properties.
  // zod-to-json-schema can leave optional/default keys in required but omit them from properties.
  const propSet = new Set(Object.keys(jsonSchema.properties));
  if (Array.isArray(jsonSchema.required)) {
    const before = jsonSchema.required.length;
    jsonSchema.required = jsonSchema.required.filter((k: string) => propSet.has(k));
    if (jsonSchema.required.length < before) {
      Logger.debug('ResponsesSchema', 'Filtered required to only keys present in properties', {
        agentName,
        schemaName,
        removedFromRequired: before - jsonSchema.required.length,
      });
    }
  }
  
  // Log final required array for verification (especially for cv_optimization)
  Logger.debug('ResponsesSchema', `Final required array for schema`, {
    agentName,
    schemaName,
    requiredProperties: jsonSchema.required,
    allProperties: propertyNames,
    hasOptimizedCv: propertyNames.includes('optimized_cv'),
    optimizedCvInRequired: jsonSchema.required.includes('optimized_cv'),
  });
  
  // CRITICAL: For CV Optimizer, explicitly verify optimized_cv is in schema
  if (schemaName === 'cv_optimization') {
    // Log full schema for debugging
    const fullSchemaJson = JSON.stringify(jsonSchema, null, 2);
    Logger.debug('ResponsesSchema', `CV Optimizer schema verification - FULL SCHEMA`, {
      agentName,
      hasOptimizedCvProperty: propertyNames.includes('optimized_cv'),
      optimizedCvInRequired: jsonSchema.required.includes('optimized_cv'),
      optimizedCvSchema: jsonSchema.properties?.optimized_cv ? 'present' : 'MISSING',
      allProperties: propertyNames,
      requiredArray: jsonSchema.required,
      fullSchemaLength: fullSchemaJson.length,
      optimizedCvPropertyKeys: jsonSchema.properties?.optimized_cv ? Object.keys(jsonSchema.properties.optimized_cv) : [],
    });
    
    // Log the full schema to console for immediate visibility
    Logger.debug('ResponsesSchema', `CV Optimizer full schema being sent to API`, {
      agentName,
      fullSchema: fullSchemaJson,
    });
    
    // If optimized_cv is missing from properties, this is a critical error
    if (!jsonSchema.properties?.optimized_cv) {
      Logger.error('ResponsesSchema', `CRITICAL: optimized_cv is missing from schema properties!`, undefined, {
        agentName,
        allProperties: propertyNames,
        schemaKeys: Object.keys(jsonSchema.properties || {}),
        fullSchema: fullSchemaJson,
      });
      throw new Error('CRITICAL: optimized_cv property is missing from CV Optimizer schema. This should never happen.');
    }
    
    // Verify optimized_cv is in required array
    if (!jsonSchema.required.includes('optimized_cv')) {
      Logger.error('ResponsesSchema', `CRITICAL: optimized_cv is NOT in required array!`, undefined, {
        agentName,
        requiredArray: jsonSchema.required,
        allProperties: propertyNames,
        fullSchema: fullSchemaJson,
      });
      throw new Error('CRITICAL: optimized_cv is not in the required array of CV Optimizer schema. This should never happen.');
    }
  }
}

// Fix additionalProperties: Responses API has strict requirements
// - All additionalProperties must be false (no nested additionalProperties objects allowed)
// - All schemas must have a 'type' key
// - z.any() generates empty objects {} which need type: "object"
// Recursively fix all nested schemas
const fixAdditionalProperties = (schema: any, depth: number = 0, currentSchemaName: string = schemaName): void => {
  if (!schema || typeof schema !== 'object') return;
  
  // CRITICAL: Fix additionalProperties FIRST before any recursive processing
  // Responses API rejects additionalProperties: {} (empty object) and strips the property - then "Extra required key" occurs.
  // Must be boolean false, or a valid schema object for record/map types (e.g. traceability_map).
  const isRecordType =
    schema.type === 'object' &&
    (!schema.properties || Object.keys(schema.properties).length === 0) &&
    typeof schema.additionalProperties === 'object' &&
    schema.additionalProperties !== null &&
    'type' in schema.additionalProperties;
  if (schema.additionalProperties !== false && !isRecordType) {
    if (typeof schema.additionalProperties === 'object' || schema.additionalProperties === true) {
      schema.additionalProperties = false;
    }
  }
  
  // Fix schemas without type (e.g., z.any() generates {})
  if (!schema.type && Object.keys(schema).length === 0) {
    // Empty object from z.any() - set to object type
    schema.type = 'object';
    schema.additionalProperties = false;
  } else if (!schema.type && schema.properties) {
    // Has properties but no type - must be an object
    schema.type = 'object';
  }
  
  // Fix additionalProperties based on Responses API requirements
  if (schema.type === 'object' && !isRecordType) {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      // Object with defined properties - Responses API requires additionalProperties: false
      schema.additionalProperties = false;
    } else if (schema.additionalProperties === undefined) {
      // No additionalProperties specified - set to false
      schema.additionalProperties = false;
    }
  }
  
  // Ensure additionalProperties is always false for objects except record/map types (Responses API requirement)
  if (schema.type === 'object' && schema.additionalProperties !== false && !isRecordType) {
    schema.additionalProperties = false;
  }
  
  // Recursively fix nested properties FIRST (but limit depth to avoid infinite recursion)
  // This ensures nested objects are fixed before we fix the current level
  if (depth < 10 && schema.properties) {
    for (const propName of Object.keys(schema.properties)) {
      const propSchema = schema.properties[propName];
      
      // If the property value is wrapped in anyOf/oneOf, we need to process the nested object
      // This happens when optional objects are converted by zodToJsonSchema
      if (propSchema && typeof propSchema === 'object') {
        // Check if this property is wrapped in anyOf/oneOf (common for optional objects)
        if (propSchema.anyOf && Array.isArray(propSchema.anyOf)) {
          // Log when we find anyOf wrapped properties (especially for contact)
          if (currentSchemaName === 'cv_optimization' && propName === 'contact') {
            Logger.debug('ResponsesSchema', `Found anyOf wrapped property: ${propName} at depth ${depth}`, {
              depth,
              propName,
              schemaName: currentSchemaName,
              anyOfLength: propSchema.anyOf.length,
            });
          }
          for (const subSchema of propSchema.anyOf) {
            // Process all non-null schema branches (object, array, etc.) so nested items get fixed too.
            if (subSchema && typeof subSchema === 'object' && subSchema.type !== 'null') {
              fixAdditionalProperties(subSchema, depth + 1, currentSchemaName);
            }
          }
        } else if (propSchema.oneOf && Array.isArray(propSchema.oneOf)) {
          // Log when we find oneOf wrapped properties (especially for contact)
          if (currentSchemaName === 'cv_optimization' && propName === 'contact') {
            Logger.debug('ResponsesSchema', `Found oneOf wrapped property: ${propName} at depth ${depth}`, {
              depth,
              propName,
              schemaName: currentSchemaName,
              oneOfLength: propSchema.oneOf.length,
            });
          }
          for (const subSchema of propSchema.oneOf) {
            // Process all non-null schema branches (object, array, etc.) so nested items get fixed too.
            if (subSchema && typeof subSchema === 'object' && subSchema.type !== 'null') {
              fixAdditionalProperties(subSchema, depth + 1, currentSchemaName);
            }
          }
        } else {
          // Normal property - recursively fix it
          fixAdditionalProperties(propSchema, depth + 1, currentSchemaName);
        }
      }
    }
  }
  
  // Fix items in arrays BEFORE fixing required array
  if (depth < 10 && schema.items) {
    fixAdditionalProperties(schema.items, depth + 1, currentSchemaName);
  }
  
  // Fix anyOf/oneOf schemas (for optional objects)
  // When a Zod object is optional, zodToJsonSchema may wrap it in anyOf/oneOf
  // We need to recursively fix the object schema inside the anyOf/oneOf
  if (depth < 10 && schema.anyOf && Array.isArray(schema.anyOf)) {
    for (const subSchema of schema.anyOf) {
      // Fix all non-null branches so array item schemas inside unions are normalized.
      if (subSchema && typeof subSchema === 'object' && subSchema.type !== 'null') {
        // Log when we find and fix anyOf/oneOf wrapped objects (especially for contact)
        if (currentSchemaName === 'cv_optimization' && depth >= 2) {
          Logger.debug('ResponsesSchema', `Found anyOf wrapped object at depth ${depth}, fixing nested schema`, {
            depth,
            schemaName: currentSchemaName,
            hasProperties: !!subSchema.properties,
            propertyNames: subSchema.properties ? Object.keys(subSchema.properties) : [],
          });
        }
        fixAdditionalProperties(subSchema, depth + 1, currentSchemaName);
      }
    }
  }
  
  if (depth < 10 && schema.oneOf && Array.isArray(schema.oneOf)) {
    for (const subSchema of schema.oneOf) {
      // Fix all non-null branches so array item schemas inside unions are normalized.
      if (subSchema && typeof subSchema === 'object' && subSchema.type !== 'null') {
        // Log when we find and fix anyOf/oneOf wrapped objects (especially for contact)
        if (currentSchemaName === 'cv_optimization' && depth >= 2) {
          Logger.debug('ResponsesSchema', `Found oneOf wrapped object at depth ${depth}, fixing nested schema`, {
            depth,
            schemaName: currentSchemaName,
            hasProperties: !!subSchema.properties,
            propertyNames: subSchema.properties ? Object.keys(subSchema.properties) : [],
          });
        }
        fixAdditionalProperties(subSchema, depth + 1, currentSchemaName);
      }
    }
  }
  
  // CRITICAL: Responses API requires ALL properties to be in the 'required' array
  // Even optional fields must be in required array - this is a Responses API quirk
  // This must happen AFTER recursive processing to ensure nested objects are also fixed
  // Also check if schema has properties but no type - set type to 'object' first
  if (schema.properties && !schema.type) {
    schema.type = 'object';
  }
  if (schema.type === 'object' && schema.properties) {
    const propertyNames = Object.keys(schema.properties);
    if (propertyNames.length > 0) {
      // Ensure required array exists
      if (!schema.required) {
        schema.required = [];
      }
      // Add ALL properties to required array (Responses API requirement)
      const requiredSet = new Set(schema.required);
      const missingFromRequired = propertyNames.filter(propName => !requiredSet.has(propName));
      if (missingFromRequired.length > 0) {
        missingFromRequired.forEach(propName => {
          schema.required.push(propName);
        });
        // Log when we fix required array for nested objects (debug only)
        if (depth > 0 || (currentSchemaName === 'cv_optimization' && (propertyNames.includes('contact') || propertyNames.includes('email')))) {
          Logger.debug('ResponsesSchema', `Fixed required array for object at depth ${depth}`, {
            depth,
            addedProperties: missingFromRequired,
            allProperties: propertyNames,
            schemaName: currentSchemaName || 'unknown',
            isContactObject: propertyNames.includes('contact') || propertyNames.includes('email'),
          });
        }
      }
    }
  }
};

fixAdditionalProperties(jsonSchema);
// Final pass: enforce Responses API object constraints everywhere, including deep union/array branches.
enforceResponsesJsonSchemaConstraints(jsonSchema);

// Final sanitization: Responses API requires required to exactly match properties (every key in properties must be in required; no key in required may be missing from properties).
// Set required = property keys so we never send "Extra required key".
if (jsonSchema.properties) {
  jsonSchema.required = Object.keys(jsonSchema.properties);
  // Optional hardening: omit keys the API may strip so we never get "Extra required key" if they drop a property
  if (schemaName === 'formatted_skills') {
    jsonSchema.required = (jsonSchema.required as string[]).filter(
      (k) => k !== 'skills_formatted' && k !== 'section_title_recommendations'
    );
  } else if (schemaName === 'formatted_experience') {
    jsonSchema.required = (jsonSchema.required as string[]).filter(
      (k) => k !== 'experience_formatted' && k !== 'experience_format_used'
    );
  } else if (schemaName === 'rewritten_sections') {
    jsonSchema.required = (jsonSchema.required as string[]).filter(
      (k) => k !== 'rewritten_sections' && k !== 'sections_rewritten'
    );
  } else if (schemaName === 'evidence_traceability') {
    // API rejects required including traceability_map (record/optional); keep only array properties.
    jsonSchema.required = (jsonSchema.required as string[]).filter(
      (k) => ['scope', 'execution', 'leadership', 'business', 'risk'].includes(k) && k in jsonSchema.properties
    );
    if (jsonSchema.required.length === 0) jsonSchema.required = Object.keys(jsonSchema.properties);
  }
}

// Log the final schema for debugging
Logger.debug('ResponsesSchema', `Final JSON schema for Responses API`, {
  agentName,
  schemaName,
  schemaType: jsonSchema.type,
  hasProperties: !!jsonSchema.properties,
  propertyCount: jsonSchema.properties ? Object.keys(jsonSchema.properties).length : 0,
});

// Ensure the schema has a $id or title that matches the name
// The Responses API requires text.format.name to match the schema identifier
if (!jsonSchema.$id && !jsonSchema.title) {
  jsonSchema.$id = schemaName;
}

const STRICT_DISABLED_SCHEMAS = new Set([
  'cv_optimization',
  'formatted_skills',
  'formatted_experience',
  'rewritten_sections',
]);
const useStrictMode = !STRICT_DISABLED_SCHEMAS.has(schemaName);
return { jsonSchema, useStrictMode };
}
