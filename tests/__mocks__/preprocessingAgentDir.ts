import path from 'path';

export function getPreprocessingAgentDir(): string {
  return path.join(process.cwd(), 'src', 'recruitment', 'preprocessing');
}
