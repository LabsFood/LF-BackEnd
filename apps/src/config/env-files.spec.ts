import { existsSync } from 'fs';
import { resolve } from 'path';

import { findRepoRoot, resolveEnvFilePaths } from './env-files';

describe('env-files', () => {
  it('finds LF-BackEnd root from apps cwd', () => {
    const appsDir = resolve(__dirname, '../..');
    const root = findRepoRoot(appsDir);
    expect(existsSync(resolve(root, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(resolve(root, 'apps', 'package.json'))).toBe(true);
  });

  it('includes repo-root .env when present', () => {
    const paths = resolveEnvFilePaths(resolve(__dirname, '../..'));
    const envPath = paths.find((p) => p.endsWith('/.env'));
    if (existsSync(resolve(findRepoRoot(), '.env'))) {
      expect(envPath).toBeDefined();
    }
  });
});
