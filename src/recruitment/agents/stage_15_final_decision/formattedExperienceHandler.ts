import type { AgentConfig } from '../agentConfig.js';
import type { OutputSchemaName } from '../schemaRegistry.js';
import type { AgentTypeHandler, PostProcessContext } from '../handlers/types.js';
import type { CommonPromptFragments } from '../promptLoader.js';

function trimStringArray(arr: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out = arr.map((x) => String(x ?? '').trim()).filter((s) => s.length > 0);
  return out;
}

/**
 * Post-process Experience Formatter output: ensure array shape and trim string list fields on entries.
 */
export const formattedExperienceHandler: AgentTypeHandler = {
  appliesTo(outputSchema: OutputSchemaName): boolean {
    return outputSchema === 'formatted_experience';
  },

  buildPromptObject(
    _fragments: CommonPromptFragments,
    promptObject: Record<string, unknown>,
    _config: AgentConfig
  ): Record<string, unknown> {
    return promptObject;
  },

  getSystemMessage(): string {
    return '';
  },

  postProcessBeforeValidation(parsed: unknown, _context: PostProcessContext): unknown {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.experience_formatted)) {
      o.experience_formatted = [];
      return o;
    }
    for (const row of o.experience_formatted) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const e = row as Record<string, unknown>;
      const resp = trimStringArray(e.responsibilities);
      if (resp) e.responsibilities = resp;
      const high = trimStringArray(e.highlights);
      if (high) e.highlights = high;
      const tags = trimStringArray(e.tags);
      if (tags) e.tags = tags;
      for (const key of ['description', 'company', 'role', 'position', 'period', 'duration', 'narrative'] as const) {
        const raw = e[key];
        if (typeof raw === 'string') {
          e[key] = raw.trim();
        }
      }
    }
    return o;
  },
};
