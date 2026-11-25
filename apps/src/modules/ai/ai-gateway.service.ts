import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { currentRequest } from '../../common/logging/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { budgetVerdict, emptySpent } from './domain/ai-budget.rules';
import { labelsProblem, type AiLabels } from './domain/ai-labels.rules';
import { costMicroEur, type AiProviderId } from './domain/ai-prices.rules';
import { AiAlertsService } from './ai-alerts.service';
import { AiBudgetService } from './ai-budget.service';
import { aiBudgetReached, aiUnavailable } from './ai.errors';
import { budgetsInForce, pricesInForce } from './ai-settings';
import type { AiContent, AiProvider, AiResponse } from './providers/ai-provider';

export const AI_PROVIDERS = Symbol('AI_PROVIDERS');

export interface AiRoute {
  provider: AiProviderId;
  model: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface AiRunInput<T> {
  labels: AiLabels;
  chefProfileId?: string | null;
  system: string;
  content: AiContent[];
  schema: Record<string, unknown>;
  schemaName: string;
  /** Le modèle préféré d'abord, puis le renfort éventuel. */
  routes: AiRoute[];
  /** Lit le texte rendu ; lève une erreur si le format est faux. */
  parse: (text: string) => T;
  /**
   * Le résultat est-il assez bon ? Non : on passe au modèle suivant (renfort). Sur
   * le dernier modèle, le résultat est rendu quand même, marqué `belowThreshold`.
   */
  accept?: (data: T) => boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiRunResult<T> {
  data: T;
  provider: AiProviderId;
  model: string;
  attempt: number;
  belowThreshold: boolean;
  costMicroEur: number;
}

type Outcome = 'ok' | 'failed' | 'invalid_output' | 'refused_budget';

/**
 * Budget IA (DAT 6 bis) : le seul point d'entrée vers un fournisseur d'IA.
 *   1. refuse un appel aux étiquettes invalides (erreur de programmation) ;
 *   2. vérifie les budgets avant chaque essai, mode strict ou souple ;
 *   3. appelle le fournisseur, avec un délai et une sortie structurée ;
 *   4. écrit une ligne `ai_usage` par essai, échecs et refus compris ;
 *   5. déclenche la vérification des alertes, sans l'attendre.
 * Le contrôle de budget n'est pas atomique : deux appels simultanés peuvent dépasser
 * le plafond d'un appel. Accepté au volume prévu ; la limite chez chaque fournisseur
 * reste le garde-fou final.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger(AiGateway.name);
  private readonly providers: Map<AiProviderId, AiProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly alerts: AiAlertsService,
    private readonly config: ConfigService,
    @Optional() @Inject(AI_PROVIDERS) providers?: AiProvider[],
  ) {
    this.providers = new Map((providers ?? []).map((p) => [p.id, p]));
  }

  /** La clé du poste (`MISTRAL_API_KEY_RECETTES`), sinon la clé nue. */
  apiKey(provider: AiProviderId, poste: string): string | undefined {
    const base = `${provider.toUpperCase()}_API_KEY`;
    return (
      this.config.get<string>(`${base}_${poste.toUpperCase()}`) ||
      this.config.get<string>(base) ||
      undefined
    );
  }

  async run<T>(input: AiRunInput<T>): Promise<AiRunResult<T>> {
    const problem = labelsProblem(input.labels);
    if (problem) throw new Error(`AiGateway: ${problem}`);
    if (input.routes.length === 0) throw new Error('AiGateway: aucun modèle.');

    let last: AiRunResult<T> | null = null;
    for (const [i, route] of input.routes.entries()) {
      const attempt = i + 1;
      await this.checkBudget(input, route, attempt);

      const provider = this.providers.get(route.provider);
      const key = this.apiKey(route.provider, input.labels.poste);
      if (!provider || !key || !provider.supports(route.model, input.content)) {
        const why = !provider
          ? 'fournisseur absent'
          : !key
            ? 'clé absente'
            : 'contenu non lu par ce modèle';
        this.logger.warn({
          event: 'ai.route_skipped',
          provider: route.provider,
          model: route.model,
          why,
        });
        continue;
      }

      const started = Date.now();
      let response: AiResponse | null = null;
      try {
        response = await provider.run(
          {
            model: route.model,
            system: input.system,
            content: input.content,
            schema: input.schema,
            schemaName: input.schemaName,
            maxTokens: input.maxTokens ?? 16_000,
            timeoutMs: input.timeoutMs ?? 120_000,
            effort: route.effort,
          },
          key,
        );
        const data = input.parse(response.text);
        const cost = await this.record(
          input,
          route,
          attempt,
          'ok',
          response,
          Date.now() - started,
        );
        const good = input.accept ? input.accept(data) : true;
        last = {
          data,
          provider: route.provider,
          model: route.model,
          attempt,
          belowThreshold: !good,
          costMicroEur: cost,
        };
        if (good) return last;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.record(
          input,
          route,
          attempt,
          response ? 'invalid_output' : 'failed',
          response,
          Date.now() - started,
          message,
        );
        this.logger.warn({
          event: 'ai.attempt_failed',
          provider: route.provider,
          model: route.model,
          message,
        });
      }
    }
    if (last) return last;
    throw aiUnavailable();
  }

  private async checkBudget<T>(input: AiRunInput<T>, route: AiRoute, attempt: number) {
    const budgets = await budgetsInForce(this.prisma);
    const spent = await this.budget.spent();
    const verdict = budgetVerdict(
      budgets,
      input.labels.poste,
      spent.global,
      spent.byPoste.get(input.labels.poste) ?? emptySpent(),
    );
    if (!verdict.refused) return;
    const first = verdict.reached[0];
    await this.record(
      input,
      route,
      attempt,
      'refused_budget',
      null,
      0,
      `${first.scope} ${first.period}`,
    );
    throw aiBudgetReached(first.scope, first.period);
  }

  private async record<T>(
    input: AiRunInput<T>,
    route: AiRoute,
    attempt: number,
    outcome: Outcome,
    response: AiResponse | null,
    durationMs: number,
    error?: string,
  ): Promise<number> {
    const used = {
      inputTokens: response?.inputTokens ?? 0,
      outputTokens: response?.outputTokens ?? 0,
      pages: response?.pages ?? 0,
    };
    const cost = response
      ? costMicroEur(await pricesInForce(this.prisma), route.provider, route.model, used)
      : 0;
    try {
      await this.prisma.aiUsage.create({
        data: {
          poste: input.labels.poste,
          feature: input.labels.feature,
          tags: input.labels.tags ?? [],
          provider: route.provider,
          model: route.model,
          chefProfileId: input.chefProfileId ?? null,
          attempt,
          ...used,
          costMicroEur: cost,
          durationMs,
          outcome,
          error: error?.slice(0, 500) ?? null,
          requestId: currentRequest()?.requestId ?? null,
        },
      });
    } catch (e) {
      // Ne jamais perdre la réponse d'un fournisseur déjà payée pour une écriture ratée.
      this.logger.error(
        'ai_usage write failed',
        e instanceof Error ? e.stack : String(e),
      );
    }
    if (cost > 0) void this.alerts.check(input.labels.poste);
    return cost;
  }
}
