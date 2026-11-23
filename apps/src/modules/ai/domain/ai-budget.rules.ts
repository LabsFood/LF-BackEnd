/**
 * Budget IA (DAT 6 bis) : les plafonds et ce qu'ils déclenchent. Un plafond par
 * période, global ou par poste ; une période sans plafond n'est pas limitée. En mode
 * strict, un appel est refusé dès qu'un plafond concerné est atteint ; en mode souple,
 * il passe et seule l'alerte part. Montants en centimes d'euro.
 */

import { PERIODS, type Period } from './ai-periods.rules';
import { AI_POSTES } from './ai-labels.rules';

export type BudgetMode = 'soft' | 'strict';
export type Caps = Partial<Record<Period, number>>;

export interface AiBudgets {
  mode: BudgetMode;
  /** Pourcentage qui déclenche la première alerte (80 par défaut). */
  alertPercent: number;
  global: Caps;
  postes: Partial<Record<string, Caps>>;
}

/** Par défaut : 50 € par mois au total, en mode souple, alerte à 80 %. */
export const DEFAULT_AI_BUDGETS: AiBudgets = {
  mode: 'soft',
  alertPercent: 80,
  global: { month: 5_000 },
  postes: {},
};

export const MAX_CAP_CENTS = 10_000_000;

/** Dépense par période, en micro-euros. */
export type Spent = Record<Period, number>;

export interface Breach {
  scope: 'global' | string;
  period: Period;
  capCents: number;
  spentMicroEur: number;
  /** 0 à 100+, arrondi à l'entier inférieur. */
  percent: number;
}

const percentOf = (spentMicro: number, capCents: number) =>
  capCents === 0 ? 100 : Math.floor(spentMicro / (capCents * 100));

function check(scope: string, caps: Caps | undefined, spent: Spent): Breach[] {
  if (!caps) return [];
  return PERIODS.flatMap((period) => {
    const capCents = caps[period];
    if (capCents === undefined || capCents === null) return [];
    return [
      {
        scope,
        period,
        capCents,
        spentMicroEur: spent[period],
        percent: percentOf(spent[period], capCents),
      },
    ];
  });
}

export interface BudgetVerdict {
  /** Refusé : mode strict et au moins un plafond atteint. */
  refused: boolean;
  /** Plafonds atteints (100 % et plus). */
  reached: Breach[];
  /** Tous les plafonds concernés, avec leur pourcentage. */
  all: Breach[];
}

/** Le verdict avant un appel pour `poste`, au vu de la dépense globale et du poste. */
export function budgetVerdict(
  budgets: AiBudgets,
  poste: string,
  spentGlobal: Spent,
  spentPoste: Spent,
): BudgetVerdict {
  const all = [
    ...check('global', budgets.global, spentGlobal),
    ...check(poste, budgets.postes[poste], spentPoste),
  ];
  const reached = all.filter((b) => b.percent >= 100);
  return { refused: budgets.mode === 'strict' && reached.length > 0, reached, all };
}

/** Les seuils d'alerte franchis : le seuil configuré et 100 %. */
export function thresholdsCrossed(budgets: AiBudgets, breach: Breach): number[] {
  return [budgets.alertPercent, 100].filter((t) => breach.percent >= t);
}

function capsFrom(value: unknown): Caps {
  const out: Caps = {};
  if (!value || typeof value !== 'object') return out;
  for (const period of PERIODS) {
    const cap = (value as Record<string, unknown>)[period];
    if (
      typeof cap === 'number' &&
      Number.isInteger(cap) &&
      cap >= 0 &&
      cap <= MAX_CAP_CENTS
    ) {
      out[period] = cap;
    }
  }
  return out;
}

/** Lit le réglage enregistré ; toute valeur hors bornes est ignorée. */
export function budgetsFrom(value: unknown): AiBudgets {
  const v = value as Partial<AiBudgets> | null;
  if (!v || typeof v !== 'object') return DEFAULT_AI_BUDGETS;
  const postes: Partial<Record<string, Caps>> = {};
  for (const poste of Object.keys(AI_POSTES)) {
    const caps = capsFrom(v.postes?.[poste]);
    if (Object.keys(caps).length) postes[poste] = caps;
  }
  return {
    mode: v.mode === 'strict' ? 'strict' : 'soft',
    alertPercent:
      typeof v.alertPercent === 'number' && v.alertPercent >= 10 && v.alertPercent <= 99
        ? Math.round(v.alertPercent)
        : DEFAULT_AI_BUDGETS.alertPercent,
    global: capsFrom(v.global),
    postes,
  };
}

export const emptySpent = (): Spent =>
  Object.fromEntries(PERIODS.map((p) => [p, 0])) as Spent;
