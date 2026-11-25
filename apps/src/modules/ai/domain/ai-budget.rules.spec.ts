import {
  budgetsFrom,
  budgetVerdict,
  DEFAULT_AI_BUDGETS,
  emptySpent,
  thresholdsCrossed,
  type AiBudgets,
} from './ai-budget.rules';
import { costMicroEur, DEFAULT_AI_PRICES, pricesFrom } from './ai-prices.rules';
import { labelsProblem } from './ai-labels.rules';

const spent = (month: number, day = 0) => ({ ...emptySpent(), month, day });

describe('budgetVerdict', () => {
  const budgets: AiBudgets = {
    mode: 'strict',
    alertPercent: 80,
    global: { month: 5_000 },
    postes: { recettes: { day: 100 } },
  };

  it('laisse passer sous le plafond', () => {
    const verdict = budgetVerdict(
      budgets,
      'recettes',
      spent(10_000_000),
      spent(0, 500_000),
    );
    expect(verdict.refused).toBe(false);
    expect(verdict.all.map((b) => b.percent)).toEqual([20, 50]);
  });

  it('refuse en mode strict quand le plafond du poste est atteint', () => {
    const verdict = budgetVerdict(budgets, 'recettes', spent(0), spent(0, 1_000_000));
    expect(verdict.refused).toBe(true);
    expect(verdict.reached).toEqual([
      expect.objectContaining({ scope: 'recettes', period: 'day', percent: 100 }),
    ]);
  });

  it('laisse passer en mode souple, plafond atteint', () => {
    const verdict = budgetVerdict(
      { ...budgets, mode: 'soft' },
      'recettes',
      spent(60_000_000),
      spent(0),
    );
    expect(verdict.refused).toBe(false);
    expect(verdict.reached).toHaveLength(1);
  });

  it("n'applique pas le plafond d'un autre poste", () => {
    const verdict = budgetVerdict(budgets, 'assistant', spent(0), spent(0, 9_000_000));
    expect(verdict.all.map((b) => b.scope)).toEqual(['global']);
  });

  it('un plafond à 0 € bloque tout appel en mode strict', () => {
    const verdict = budgetVerdict(
      { ...budgets, global: { day: 0 } },
      'recettes',
      spent(0),
      spent(0),
    );
    expect(verdict.refused).toBe(true);
  });
});

describe('thresholdsCrossed', () => {
  it('donne 80 puis 100', () => {
    const breach = {
      scope: 'global',
      period: 'month' as const,
      capCents: 100,
      spentMicroEur: 0,
      percent: 85,
    };
    expect(thresholdsCrossed(DEFAULT_AI_BUDGETS, breach)).toEqual([80]);
    expect(thresholdsCrossed(DEFAULT_AI_BUDGETS, { ...breach, percent: 130 })).toEqual([
      80, 100,
    ]);
  });
});

describe('budgetsFrom', () => {
  it('ignore les valeurs hors bornes et les postes inconnus', () => {
    expect(
      budgetsFrom({
        mode: 'strict',
        alertPercent: 150,
        global: { month: -1, day: 300, foo: 2 },
        postes: { recettes: { week: 1000 }, inconnu: { day: 1 } },
      }),
    ).toEqual({
      mode: 'strict',
      alertPercent: 80,
      global: { day: 300 },
      postes: { recettes: { week: 1000 } },
    });
  });

  it('retombe sur les valeurs par défaut sans réglage', () => {
    expect(budgetsFrom(null)).toBe(DEFAULT_AI_BUDGETS);
  });
});

describe('costMicroEur', () => {
  it('calcule depuis les jetons et les pages', () => {
    const prices = { usdToEur: 1, models: DEFAULT_AI_PRICES.models };
    expect(
      costMicroEur(prices, 'anthropic', 'claude-sonnet-5-5', {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        pages: 0,
      }),
    ).toBe(3_000_000);
    expect(
      costMicroEur(prices, 'mistral', 'mistral-ocr-latest', {
        inputTokens: 0,
        outputTokens: 0,
        pages: 3,
      }),
    ).toBe(15_000);
  });

  it('compte un modèle inconnu au prix le plus cher', () => {
    const prices = { usdToEur: 1, models: DEFAULT_AI_PRICES.models };
    expect(
      costMicroEur(prices, 'anthropic', 'nouveau', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        pages: 0,
      }),
    ).toBe(4_000_000);
  });

  it('garde les prix par défaut quand le réglage est abîmé', () => {
    expect(pricesFrom({ usdToEur: 'x' })).toBe(DEFAULT_AI_PRICES);
  });
});

describe('labelsProblem', () => {
  it('accepte un poste, une fonctionnalité et des tags valides', () => {
    expect(
      labelsProblem({
        poste: 'recettes',
        feature: 'import_recette',
        tags: ['source:pdf'],
      }),
    ).toBeNull();
  });

  it('refuse un poste inconnu, une fonctionnalité d’un autre poste, un tag mal formé', () => {
    expect(labelsProblem({ poste: 'x', feature: 'import_recette' })).toContain(
      'Poste inconnu',
    );
    expect(labelsProblem({ poste: 'vitrine', feature: 'import_recette' })).toContain(
      'inconnue',
    );
    expect(
      labelsProblem({
        poste: 'recettes',
        feature: 'import_recette',
        tags: ['Source PDF'],
      }),
    ).toContain('Tag invalide');
  });
});
