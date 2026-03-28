import path from 'path';

export function getExecutionTimeTrackerDir(): string {
  return path.join(process.cwd(), 'src', 'recruitment', 'utils');
}
