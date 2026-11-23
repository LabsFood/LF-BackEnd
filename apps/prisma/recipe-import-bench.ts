/**
 * Import de recettes par IA, plan J2 : banc de comparaison des modèles.
 *
 * Range les fiches d'exemple par type de source, dans des sous-dossiers :
 *   bench-recettes/fiches/pdf/      PDF de cuisiniers
 *   bench-recettes/fiches/notes/    captures de l'app Notes (png, jpg, webp)
 *   bench-recettes/fiches/livre/    photos de livres de cuisine
 *   bench-recettes/fiches/texte/    texte collé (.txt)
 * Le dossier `bench-recettes/` est ignoré par git : les fiches des cuisiniers ne sont
 * jamais commitées. Lit les clés MISTRAL_API_KEY_RECETTES et ANTHROPIC_API_KEY_RECETTES
 * (ou MISTRAL_API_KEY / ANTHROPIC_API_KEY) dans le `.env` du dépôt.
 *
 * Options :
 *   --dir <dossier>        fiches (défaut bench-recettes/fiches)
 *   --out <dossier>        rapport (défaut bench-recettes/resultats)
 *   --providers a,b        parmi mistral-ocr, mistral-small, claude-haiku,
 *                          claude-sonnet, claude-opus (défaut : les quatre premiers)
 *   --effort low|medium|high   effort des modèles Claude (défaut medium)
 *   --limit <n>            n fiches au plus par type de source, pour un essai
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { extname, join, resolve } from 'path';

import { loadRepoEnv } from '../src/config/env-files';
import { formatReport, runBench } from '../src/modules/recipe-import/bench/bench.runner';
import {
  PROVIDER_IDS,
  benchProvider,
  type Effort,
  type ProviderId,
  type SourceFile,
  type SourceKind,
} from '../src/modules/recipe-import/bench/providers';
import { catalogIndexFromCsv } from '../src/modules/recipe-import/extraction/scoring';

loadRepoEnv();

const argv = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/plain',
};
const KINDS: SourceKind[] = ['pdf', 'notes', 'livre', 'texte'];

function loadFiles(dir: string, limit: number): SourceFile[] {
  const files: SourceFile[] = [];
  for (const kind of KINDS) {
    const folder = join(dir, kind);
    if (!existsSync(folder)) continue;
    const names = readdirSync(folder)
      .filter((n) => !n.startsWith('.'))
      .sort();
    for (const name of names.slice(0, limit)) {
      const mimeType = MIME[extname(name).toLowerCase()];
      if (!mimeType) {
        console.warn(`Ignoré (format non lu, convertir HEIC en JPEG) : ${kind}/${name}`);
        continue;
      }
      files.push({
        name: `${kind}/${name}`,
        kind,
        mimeType,
        data: readFileSync(join(folder, name)),
      });
    }
  }
  return files;
}

async function main() {
  const dir = resolve(option('dir') ?? 'bench-recettes/fiches');
  const out = resolve(option('out') ?? 'bench-recettes/resultats');
  const effort = (option('effort') ?? 'medium') as Effort;
  const limit = Number(option('limit') ?? Infinity);
  const ids = (
    option('providers') ?? 'mistral-ocr,mistral-small,claude-haiku,claude-sonnet'
  )
    .split(',')
    .map((s) => s.trim()) as ProviderId[];
  const unknown = ids.filter((id) => !PROVIDER_IDS.includes(id));
  if (unknown.length) throw new Error(`Modèle inconnu : ${unknown.join(', ')}`);
  if (!['low', 'medium', 'high'].includes(effort))
    throw new Error(`Effort inconnu : ${effort}`);

  const files = loadFiles(dir, limit);
  if (files.length === 0)
    throw new Error(`Aucune fiche dans ${dir}/{${KINDS.join(',')}}.`);
  const index = catalogIndexFromCsv(
    readFileSync(join(__dirname, 'data/ingredients-v1.csv'), 'utf8'),
  );
  console.log(`${files.length} fiches, modèles : ${ids.join(', ')}, effort ${effort}`);

  const report = await runBench(
    files,
    ids.map((id) => benchProvider(id, effort)),
    index,
    { log: (line) => console.log(line) },
  );

  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(out, `banc-${stamp}.md`), formatReport(report));
  writeFileSync(join(out, `banc-${stamp}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${formatReport(report)}\nRapport : ${join(out, `banc-${stamp}.md`)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
