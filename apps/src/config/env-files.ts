import { existsSync, readFileSync } from 'fs';
import { parse } from 'dotenv';
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

/**
 * Load repo-root env files into `process.env` (Prisma CLI, scripts).
 *
 * `.env` then `.env.local` (later wins). Existing `process.env` (shell exports)
 * is never clobbered by `.env`. A later file only overrides with a non-empty
 * value, so a blank `KEY=` in `.env.local` cannot wipe a real value from `.env`.
 */
export const loadRepoEnv = (startDir = process.cwd()): void => {
  const paths = resolveEnvFilePaths(startDir);
  paths.forEach((path, index) => {
    const parsed = parse(readFileSync(path));
    const isOverrideFile = index > 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      } else if (isOverrideFile && value.trim() !== '') {
        process.env[key] = value;
      }
    }
  });
};
