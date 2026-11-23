import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { emptySpent, type Spent } from './domain/ai-budget.rules';
import { PERIODS, periodStarts, type Period } from './domain/ai-periods.rules';

/** Budget IA : la dépense de chaque période, en une requête. */
@Injectable()
export class AiBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dépense globale et par poste, en micro-euros, sur les huit périodes. */
  async spent(
    now: Date = new Date(),
  ): Promise<{ global: Spent; byPoste: Map<string, Spent> }> {
    const starts = periodStarts(now);
    const oldest = new Date(Math.min(...PERIODS.map((p) => starts[p].getTime())));
    const columns = PERIODS.map(
      (p) =>
        Prisma.sql`COALESCE(SUM(cost_micro_eur) FILTER (WHERE created_at >= ${starts[p]}), 0)::bigint AS ${Prisma.raw(`"${p}"`)}`,
    );
    const rows = await this.prisma.$queryRaw<
      ({ poste: string } & Record<Period, bigint>)[]
    >`
      SELECT poste, ${Prisma.join(columns)}
      FROM ai_usage
      WHERE created_at >= ${oldest}
      GROUP BY poste`;
    const global = emptySpent();
    const byPoste = new Map<string, Spent>();
    for (const row of rows) {
      const spent = emptySpent();
      for (const p of PERIODS) {
        spent[p] = Number(row[p]);
        global[p] += spent[p];
      }
      byPoste.set(row.poste, spent);
    }
    return { global, byPoste };
  }
}
