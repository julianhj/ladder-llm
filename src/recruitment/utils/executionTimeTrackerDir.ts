import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** Directory of the ExecutionTimeTracker module (used for logs path). ESM only; Jest uses a mock. */
export function getExecutionTimeTrackerDir(): string {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.length > 0) {
      return dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // Fall through to cwd fallback for non-Node runtimes.
  }
  return process.cwd();
}
