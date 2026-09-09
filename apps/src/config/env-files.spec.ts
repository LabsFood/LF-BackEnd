import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

import { findRepoRoot, loadRepoEnv, resolveEnvFilePaths } from './env-files';

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

  describe('loadRepoEnv override semantics', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(resolve(tmpdir(), 'lf-env-'));
      writeFileSync(resolve(root, 'docker-compose.yml'), '');
      const appsDir = resolve(root, 'apps');
      mkdirSync(appsDir, { recursive: true });
      writeFileSync(resolve(appsDir, 'package.json'), '{}');
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      delete process.env.LF_TEST_SECRET;
    });

    it('does not let a blank value in .env.local clobber a real value in .env', () => {
      writeFileSync(resolve(root, '.env'), 'LF_TEST_SECRET=sk_test_real123\n');
      writeFileSync(resolve(root, '.env.local'), 'LF_TEST_SECRET=\n');

      delete process.env.LF_TEST_SECRET;
      loadRepoEnv(root);

      expect(process.env.LF_TEST_SECRET).toBe('sk_test_real123');
    });

    it('lets a non-empty value in .env.local override .env', () => {
      writeFileSync(resolve(root, '.env'), 'LF_TEST_SECRET=from_env\n');
      writeFileSync(resolve(root, '.env.local'), 'LF_TEST_SECRET=from_local\n');

      delete process.env.LF_TEST_SECRET;
      loadRepoEnv(root);

      expect(process.env.LF_TEST_SECRET).toBe('from_local');
    });
  });
});
