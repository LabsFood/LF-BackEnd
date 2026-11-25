import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../integrations/brevo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_POSTES } from './domain/ai-labels.rules';
import { budgetVerdict, emptySpent, thresholdsCrossed } from './domain/ai-budget.rules';
import { PERIOD_LABELS, periodKey } from './domain/ai-periods.rules';
import { AiBudgetService } from './ai-budget.service';
import { budgetsInForce } from './ai-settings';

const euros = (micro: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    micro / 1_000_000,
  );

/**
 * Budget IA : l'e-mail aux administrateurs à l'alerte (80 % par défaut) et à 100 %,
 * une seule fois par période et par seuil (table `ai_budget_alerts`). Au mieux : une
 * alerte perdue n'arrête jamais un appel.
 */
@Injectable()
export class AiAlertsService {
  private readonly logger = new Logger(AiAlertsService.name);
  private readonly adminEmail?: string;
  private readonly budgetUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.adminEmail = config.get<string>('contact.notificationEmail') || undefined;
    const site = config
      .get<string>('contact.adminSiteUrl', 'https://admin.labsfood.fr')
      .replace(/\/+$/, '');
    this.budgetUrl = `${site}/budget-ia`;
  }

  async check(poste: string, now: Date = new Date()): Promise<void> {
    try {
      const budgets = await budgetsInForce(this.prisma);
      const spent = await this.budget.spent(now);
      const verdict = budgetVerdict(
        budgets,
        poste,
        spent.global,
        spent.byPoste.get(poste) ?? emptySpent(),
      );
      for (const breach of verdict.all) {
        for (const threshold of thresholdsCrossed(budgets, breach)) {
          const fresh = await this.claim(
            breach.scope,
            breach.period,
            periodKey(breach.period, now),
            threshold,
          );
          if (!fresh) continue;
          this.logger.warn({ event: 'ai.budget_alert', ...breach, threshold });
          if (!this.adminEmail) continue;
          const scopeLabel =
            breach.scope === 'global'
              ? 'global'
              : ((AI_POSTES as Record<string, { label: string }>)[breach.scope]?.label ??
                breach.scope);
          await this.brevo.sendTemplate({
            templateId: this.brevo.templates.aiBudgetAlert,
            to: { email: this.adminEmail },
            label: 'ai-budget-alert',
            params: {
              scope: scopeLabel,
              period: PERIOD_LABELS[breach.period].toLowerCase(),
              percent: breach.percent,
              spent: euros(breach.spentMicroEur),
              cap: euros(breach.capCents * 10_000),
              blocked: budgets.mode === 'strict' && threshold >= 100,
              budgetUrl: this.budgetUrl,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `AI budget alert check failed for ${poste}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** true quand cette alerte n'était pas encore partie. */
  private async claim(scope: string, period: string, key: string, threshold: number) {
    const { count } = await this.prisma.aiBudgetAlert.createMany({
      data: [{ scope, period, periodKey: key, threshold }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
