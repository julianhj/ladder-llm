import path from 'path';

export function getConfigLoaderDir(): string {
  return path.join(process.cwd(), 'src', 'recruitment', 'loaders');
}
