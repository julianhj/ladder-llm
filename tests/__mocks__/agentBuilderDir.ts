import path from 'path';

/** Mock for getAgentBuilderDir in Jest (avoids import.meta in CJS). */
export function getAgentBuilderDir(): string {
  return path.join(process.cwd(), 'src', 'recruitment', 'agents');
}
