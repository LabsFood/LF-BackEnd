import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DAY_MS, parisToday } from '../../common/paris-time';
import { AI_POSTES } from './domain/ai-labels.rules';
import { budgetVerdict, emptySpent } from './domain/ai-budget.rules';
import { PERIOD_LABELS, PERIODS } from './domain/ai-periods.rules';
import { AiBudgetService } from './ai-budget.service';
import { budgetsInForce } from './ai-settings';

const cents = (micro: number) => Math.round(micro / 10_000);

export type BreakdownBy = 'poste' | 'feature' | 'provider' | 'model' | 'chef' | 'tag';

/** Budget IA : ce que la page de la console affiche. Montants en centimes d'euro. */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
  ) {}

  /** Les huit périodes, globales et par poste, avec leur plafond et le pourcentage. */
  async summary(now: Date = new Date()) {
    const budgets = await budgetsInForce(this.prisma);
    const spent = await this.budget.spent(now);
    const verdict = budgetVerdict(budgets, '', spent.global, emptySpent());
    const periods = PERIODS.map((period) => ({
      period,
      label: PERIOD_LABELS[period],
      spentCents: cents(spent.global[period]),
      capCents: budgets.global[period] ?? null,
      percent: verdict.all.find((b) => b.period === period)?.percent ?? null,
    }));
    const postes = Object.entries(AI_POSTES).map(([code, def]) => {
      const s = spent.byPoste.get(code) ?? emptySpent();
      return {
        code,
        label: def.label,
        spentCents: Object.fromEntries(PERIODS.map((p) => [p, cents(s[p])])),
        capsCents: budgets.postes[code] ?? {},
      };
    });
    return { mode: budgets.mode, alertPercent: budgets.alertPercent, periods, postes };
  }

  /** La dépense par jour de Paris sur `days` jours, par poste. */
  async daily(days: number, now: Date = new Date()) {
    const from = new Date(
      parisToday(now).getTime() - (days - 1) * DAY_MS - 2 * 3_600_000,
    );
    const rows = await this.prisma.$queryRaw<
      { day: Date; poste: string; micro: bigint; calls: bigint }[]
    >`
      SELECT (created_at AT TIME ZONE 'Europe/Paris')::date AS day, poste,
             COALESCE(SUM(cost_micro_eur), 0)::bigint AS micro, COUNT(*)::bigint AS calls
      FROM ai_usage WHERE created_at >= ${from}
      GROUP BY 1, 2 ORDER BY 1`;
    const start = parisToday(now).getTime() - (days - 1) * DAY_MS;
    const byDay = new Map<
      string,
      { date: string; totalCents: number; calls: number; postes: Record<string, number> }
    >();
    for (let i = 0; i < days; i++) {
      const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
      byDay.set(date, { date, totalCents: 0, calls: 0, postes: {} });
    }
    for (const row of rows) {
      const entry = byDay.get(row.day.toISOString().slice(0, 10));
      if (!entry) continue;
      const c = cents(Number(row.micro));
      entry.totalCents += c;
      entry.calls += Number(row.calls);
      entry.postes[row.poste] = (entry.postes[row.poste] ?? 0) + c;
    }
    return { days: [...byDay.values()] };
  }

  /** La répartition sur `days` jours, selon un axe ; `poste` filtre en option. */
  async breakdown(by: BreakdownBy, days: number, poste?: string, now: Date = new Date()) {
    const from = new Date(now.getTime() - days * DAY_MS);
    const key =
      by === 'tag'
        ? Prisma.sql`unnest(tags)`
        : by === 'chef'
          ? Prisma.sql`COALESCE(chef_profile_id::text, '')`
          : Prisma.raw(`"${by}"`);
    const rows = await this.prisma.$queryRaw<
      {
        key: string;
        micro: bigint;
        calls: bigint;
        failures: bigint;
        avg_ms: number | null;
      }[]
    >`
      SELECT ${key} AS key,
             COALESCE(SUM(cost_micro_eur), 0)::bigint AS micro,
             COUNT(*)::bigint AS calls,
             COUNT(*) FILTER (WHERE outcome <> 'ok')::bigint AS failures,
             AVG(duration_ms) FILTER (WHERE outcome = 'ok')::float AS avg_ms
      FROM ai_usage
      WHERE created_at >= ${from} ${poste ? Prisma.sql`AND poste = ${poste}` : Prisma.empty}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 100`;
    const chefNames =
      by === 'chef'
        ? new Map(
            (
              await this.prisma.chefProfile.findMany({
                where: { id: { in: rows.map((r) => r.key).filter(Boolean) } },
                select: { id: true, displayName: true },
              })
            ).map((c) => [c.id, c.displayName]),
          )
        : null;
    return {
      by,
      days,
      rows: rows.map((r) => {
        const calls = Number(r.calls);
        return {
          key: r.key,
          label: chefNames
            ? (chefNames.get(r.key) ?? (r.key ? 'Compte supprimé' : 'Hors cuisinier'))
            : labelOf(by, r.key),
          costCents: cents(Number(r.micro)),
          calls,
          failures: Number(r.failures),
          avgCostCents: calls ? cents(Number(r.micro) / calls) : 0,
          avgDurationMs: r.avg_ms === null ? null : Math.round(r.avg_ms),
        };
      }),
    };
  }
}

function labelOf(by: BreakdownBy, key: string): string {
  const postes = AI_POSTES as Record<
    string,
    { label: string; features: Record<string, string> }
  >;
  if (by === 'poste') return postes[key]?.label ?? key;
  if (by === 'feature') {
    for (const p of Object.values(postes)) if (p.features[key]) return p.features[key];
  }
  return key;
}
