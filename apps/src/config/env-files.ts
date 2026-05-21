import { existsSync } from 'fs';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';

/** Repo root (LF-BackEnd), whether cwd is repo root or `apps/`. */
export const findRepoRoot = (startDir = process.cwd()): string => {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(resolve(dir, 'docker-compose.yml')) &&
      existsSync(resolve(dir, 'apps', 'package.json'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return resolve(startDir);
};

/** `.env` then `.env.local` at repo root (later overrides). Only existing files. */
export const resolveEnvFilePaths = (startDir = process.cwd()): string[] => {
  const root = findRepoRoot(startDir);
  return [resolve(root, '.env'), resolve(root, '.env.local')].filter((path) =>
    existsSync(path),
  );
};

/** Load repo-root env files into `process.env` (TypeORM CLI, scripts). */
export const loadRepoEnv = (startDir = process.cwd()): void => {
  const paths = resolveEnvFilePaths(startDir);
  paths.forEach((path, index) => {
    config({ path, override: index > 0, quiet: true });
  });
};
