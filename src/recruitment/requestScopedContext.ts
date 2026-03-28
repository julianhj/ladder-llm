import type { ExecutionTimeTracker } from './utils/ExecutionTimeTracker.js';

/** Request-scoped context for a single assessment run. Ensures concurrent runs do not share mutable state. */
export interface RequestScopedContext {
  correlationToken: string;
  sessionToken: string | null;
  runId: string;
  tracker: ExecutionTimeTracker;
}
