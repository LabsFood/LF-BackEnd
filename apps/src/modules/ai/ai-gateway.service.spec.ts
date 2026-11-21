import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import { emptySpent } from './domain/ai-budget.rules';
import type { AiAlertsService } from './ai-alerts.service';
import type { AiBudgetService } from './ai-budget.service';
import { AiGateway, type AiRunInput } from './ai-gateway.service';
import type { AiProvider, AiResponse } from './providers/ai-provider';

const answer = (text: string): AiResponse => ({
  text,
  inputTokens: 1_000_000,
  outputTokens: 0,
  pages: 0,
});

function setup(opts: {
  budgets?: unknown;
  spentMonth?: number;
  keys?: Record<string, string>;
  mistral?: (model: string) => Promise<AiResponse>;
  anthropic?: (model: string) => Promise<AiResponse>;
}) {
  const rows: Record<string, unknown>[] = [];
  const prisma = {
    platformSetting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          where.key === 'ai_budgets' && opts.budgets ? { value: opts.budgets } : null,
        ),
      ),
    },
    aiUsage: {
      create: jest.fn(
        ({ data }: { data: Record<string, unknown> }) => (
          rows.push(data),
          Promise.resolve(data)
        ),
      ),
    },
  } as unknown as PrismaService;
  const budget = {
    spent: jest.fn(() =>
      Promise.resolve({
        global: { ...emptySpent(), month: opts.spentMonth ?? 0 },
        byPoste: new Map(),
      }),
    ),
  } as unknown as AiBudgetService;
  const alerts = {
    check: jest.fn(() => Promise.resolve()),
  } as unknown as AiAlertsService;
  const keys = opts.keys ?? { MISTRAL_API_KEY_RECETTES: 'mk', ANTHROPIC_API_KEY: 'ak' };
  const config = { get: (name: string) => keys[name] } as unknown as ConfigService;
  const provider = (
    id: 'mistral' | 'anthropic',
    run?: (model: string) => Promise<AiResponse>,
  ): AiProvider => ({
    id,
    supports: () => true,
    run: (req) => (run ? run(req.model) : Promise.resolve(answer('{"ok":true}'))),
  });
  const gateway = new AiGateway(prisma, budget, alerts, config, [
    provider('mistral', opts.mistral),
    provider('anthropic', opts.anthropic),
  ]);
  return { gateway, rows, alerts };
}

const input = (
  over: Partial<AiRunInput<{ ok: boolean }>> = {},
): AiRunInput<{ ok: boolean }> => ({
  labels: { poste: 'recettes', feature: 'import_recette', tags: ['source:pdf'] },
  chefProfileId: '11111111-1111-4111-8111-111111111111',
  system: 's',
  content: [{ type: 'text', text: 'recette' }],
  schema: {},
  schemaName: 'x',
  routes: [
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  ],
  parse: (text) => JSON.parse(text) as { ok: boolean },
  ...over,
});

describe('AiGateway', () => {
  it('écrit une ligne étiquetée avec son coût et rend le premier résultat accepté', async () => {
    const { gateway, rows, alerts } = setup({});
    const result = await gateway.run(input());
    expect(result).toMatchObject({
      provider: 'mistral',
      attempt: 1,
      belowThreshold: false,
      data: { ok: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      poste: 'recettes',
      feature: 'import_recette',
      tags: ['source:pdf'],
      outcome: 'ok',
      costMicroEur: 138_000, // 1 M jetons × 0,15 $ × 0,92
    });
    expect(alerts.check).toHaveBeenCalledWith('recettes');
  });

  it('refuse un appel aux étiquettes invalides, sans rien envoyer', async () => {
    const { gateway, rows } = setup({});
    await expect(
      gateway.run(input({ labels: { poste: 'recettes', feature: 'inconnue' } })),
    ).rejects.toThrow('inconnue');
    expect(rows).toHaveLength(0);
  });

  it('refuse en mode strict au plafond, avec un motif lisible, et le trace', async () => {
    const { gateway, rows } = setup({
      budgets: { mode: 'strict', global: { month: 100 } },
      spentMonth: 1_000_000,
    });
    const error = await gateway.run(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AI_BUDGET_REACHED',
      period: 'month',
    });
    expect(rows).toEqual([
      expect.objectContaining({ outcome: 'refused_budget', costMicroEur: 0 }),
    ]);
  });

  it('laisse passer en mode souple au plafond', async () => {
    const { gateway } = setup({
      budgets: { mode: 'soft', global: { month: 100 } },
      spentMonth: 1_000_000,
    });
    await expect(gateway.run(input())).resolves.toMatchObject({ attempt: 1 });
  });

  it('passe au renfort quand le premier échoue ou rend un JSON invalide', async () => {
    const failing = setup({ mistral: () => Promise.reject(new Error('HTTP 500')) });
    await expect(failing.gateway.run(input())).resolves.toMatchObject({
      provider: 'anthropic',
      attempt: 2,
    });
    expect(failing.rows.map((r) => r.outcome)).toEqual(['failed', 'ok']);

    const invalid = setup({ mistral: () => Promise.resolve(answer('pas du json')) });
    await invalid.gateway.run(input());
    expect(invalid.rows.map((r) => r.outcome)).toEqual(['invalid_output', 'ok']);
    expect(invalid.rows[0].costMicroEur).toBeGreaterThan(0);
  });

  it('passe au renfort sous le seuil, et rend le dernier résultat marqué quand aucun ne suffit', async () => {
    const { gateway } = setup({});
    const result = await gateway.run(input({ accept: () => false }));
    expect(result).toMatchObject({ provider: 'anthropic', belowThreshold: true });
  });

  it('saute un modèle sans clé et lève AI_UNAVAILABLE quand rien ne répond', async () => {
    const noKey = setup({ keys: { ANTHROPIC_API_KEY_RECETTES: 'k' } });
    await expect(noKey.gateway.run(input())).resolves.toMatchObject({
      provider: 'anthropic',
    });

    const none = setup({ keys: {} });
    await expect(none.gateway.run(input())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_UNAVAILABLE' }),
    });
  });
});
