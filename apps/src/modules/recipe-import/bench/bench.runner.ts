/**
 * Import de recettes par IA (plan J2) : le banc. Chaque fiche passe par chaque
 * modèle qui sait la lire ; on note l'extraction, on mesure le temps et le coût, puis
 * on agrège par type de source et par modèle. Le seuil de décision du DAT : au moins
 * 80 % des lignes d'ingrédients reliées à la liste commune sans retouche.
 */

import {
  parseExtraction,
  scoreExtraction,
  type ExtractionScore,
} from '../extraction/scoring';
import type { Provider, SourceFile, SourceKind } from './providers';

export const LINK_RATE_THRESHOLD = 0.8;

export interface BenchRun {
  file: string;
  kind: SourceKind;
  provider: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  costUsd: number;
  score?: ExtractionScore;
}

export interface BenchAggregate {
  provider: string;
  kind: SourceKind;
  runs: number;
  failures: number;
  /** Lignes reliées / lignes, toutes fiches réussies du groupe confondues. */
  linkRate: number;
  recipesWithoutSteps: number;
  missingFields: number;
  avgDurationMs: number;
  totalCostUsd: number;
  passes: boolean;
}

export interface BenchReport {
  runs: BenchRun[];
  aggregates: BenchAggregate[];
}

type Clock = () => number;

export async function runBench(
  files: SourceFile[],
  providers: Provider[],
  index: Map<string, string>,
  options: { now?: Clock; log?: (line: string) => void } = {},
): Promise<BenchReport> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const runs: BenchRun[] = [];
  for (const file of files) {
    for (const provider of providers) {
      if (!provider.supports(file)) continue;
      const started = now();
      const base = { file: file.name, kind: file.kind, provider: provider.id };
      try {
        const result = await provider.extract(file);
        const score = scoreExtraction(parseExtraction(result.text), index);
        runs.push({
          ...base,
          ok: true,
          durationMs: now() - started,
          costUsd: provider.cost(result),
          score,
        });
        log(
          `${provider.id} ${file.name} : ${(score.linkRate * 100).toFixed(0)} % reliées`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runs.push({
          ...base,
          ok: false,
          error: message,
          durationMs: now() - started,
          costUsd: 0,
        });
        log(`${provider.id} ${file.name} : échec (${message})`);
      }
    }
  }
  return { runs, aggregates: aggregate(runs) };
}

export function aggregate(runs: BenchRun[]): BenchAggregate[] {
  const groups = new Map<string, BenchRun[]>();
  for (const run of runs) {
    const id = `${run.provider}\u0000${run.kind}`;
    groups.set(id, [...(groups.get(id) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const ok = group.filter((r) => r.ok && r.score);
    const lines = ok.reduce((n, r) => n + (r.score?.ingredients ?? 0), 0);
    const linked = ok.reduce((n, r) => n + (r.score?.linked ?? 0), 0);
    const linkRate = lines === 0 ? 0 : linked / lines;
    const failures = group.length - ok.length;
    return {
      provider: group[0].provider,
      kind: group[0].kind,
      runs: group.length,
      failures,
      linkRate,
      recipesWithoutSteps: ok.reduce(
        (n, r) => n + (r.score?.recipesWithoutSteps ?? 0),
        0,
      ),
      missingFields: ok.reduce((n, r) => n + (r.score?.missingFields ?? 0), 0),
      avgDurationMs: Math.round(
        group.reduce((n, r) => n + r.durationMs, 0) / group.length,
      ),
      totalCostUsd: group.reduce((n, r) => n + r.costUsd, 0),
      passes: failures === 0 && linkRate >= LINK_RATE_THRESHOLD,
    };
  });
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

/** Le rapport lisible, en Markdown. */
export function formatReport(report: BenchReport): string {
  const rows = [...report.aggregates].sort(
    (a, b) => a.kind.localeCompare(b.kind) || b.linkRate - a.linkRate,
  );
  const lines = [
    '# Banc import de recettes',
    '',
    `Seuil : ${pct(LINK_RATE_THRESHOLD)} des lignes d'ingrédients reliées, sans échec.`,
    '',
    '| Source | Modèle | Fiches | Échecs | Reliées | Sans étapes | Champs vides | Temps moyen | Coût total | Seuil |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (a) =>
        `| ${a.kind} | ${a.provider} | ${a.runs} | ${a.failures} | ${pct(a.linkRate)} | ${a.recipesWithoutSteps} | ${a.missingFields} | ${(a.avgDurationMs / 1000).toFixed(1)} s | ${a.totalCostUsd.toFixed(4)} $ | ${a.passes ? 'oui' : 'non'} |`,
    ),
  ];
  const failures = report.runs.filter((r) => !r.ok);
  if (failures.length) {
    lines.push(
      '',
      '## Échecs',
      '',
      ...failures.map((r) => `- ${r.provider} / ${r.file} : ${r.error}`),
    );
  }
  const unlinked = new Map<string, number>();
  for (const run of report.runs) {
    for (const name of run.score?.unlinkedNames ?? []) {
      unlinked.set(name, (unlinked.get(name) ?? 0) + 1);
    }
  }
  if (unlinked.size) {
    const top = [...unlinked].sort((a, b) => b[1] - a[1]).slice(0, 30);
    lines.push(
      '',
      '## Noms non reliés les plus fréquents',
      '',
      'À ajouter comme autres noms dans la liste commune si ce sont de vrais ingrédients.',
      '',
      ...top.map(([name, n]) => `- ${name} (${n})`),
    );
  }
  return lines.join('\n') + '\n';
}
