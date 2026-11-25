/**
 * Budget IA (DAT 6 bis) : le coût d'un appel, en micro-euros (millionièmes d'euro)
 * pour rester en entiers. Les prix par défaut sont ceux relevés le 21/11/2026 ; la
 * console peut les remplacer (réglage `ai_prices`) sans déploiement.
 */

export type AiProviderId = 'mistral' | 'anthropic';

export interface ModelPrice {
  /** Dollars par million de jetons. */
  inputUsdPerM: number;
  outputUsdPerM: number;
  /** Dollars par page, pour l'OCR. */
  pageUsd?: number;
}

export interface AiPrices {
  /** Euros pour un dollar. */
  usdToEur: number;
  models: Record<string, ModelPrice>;
}

export const DEFAULT_AI_PRICES: AiPrices = {
  usdToEur: 0.92,
  models: {
    'mistral/mistral-ocr-latest': { inputUsdPerM: 0, outputUsdPerM: 0, pageUsd: 0.005 },
    'mistral/mistral-small-latest': { inputUsdPerM: 0.15, outputUsdPerM: 0.6 },
    'anthropic/claude-haiku-5-5': { inputUsdPerM: 0.1, outputUsdPerM: 0.5 },
    'anthropic/claude-sonnet-5-5': { inputUsdPerM: 2, outputUsdPerM: 10 },
    'anthropic/claude-opus-5-5': { inputUsdPerM: 4, outputUsdPerM: 20 },
  },
};

export const priceKey = (provider: AiProviderId, model: string) => `${provider}/${model}`;

export interface Consumption {
  inputTokens: number;
  outputTokens: number;
  pages: number;
}

/**
 * Le coût en micro-euros, arrondi au supérieur. Un modèle sans prix connu est
 * compté au prix le plus cher de la table : mieux vaut surestimer que laisser filer.
 */
export function costMicroEur(
  prices: AiPrices,
  provider: AiProviderId,
  model: string,
  used: Consumption,
): number {
  const price = prices.models[priceKey(provider, model)] ?? mostExpensive(prices);
  const usd =
    (used.inputTokens / 1_000_000) * price.inputUsdPerM +
    (used.outputTokens / 1_000_000) * price.outputUsdPerM +
    used.pages * (price.pageUsd ?? 0);
  return Math.ceil(usd * prices.usdToEur * 1_000_000);
}

function mostExpensive(prices: AiPrices): ModelPrice {
  const all = Object.values(prices.models);
  return {
    inputUsdPerM: Math.max(0, ...all.map((p) => p.inputUsdPerM)),
    outputUsdPerM: Math.max(0, ...all.map((p) => p.outputUsdPerM)),
    pageUsd: Math.max(0, ...all.map((p) => p.pageUsd ?? 0)),
  };
}

/** Lit le réglage enregistré ; une valeur abîmée retombe sur les prix par défaut. */
export function pricesFrom(value: unknown): AiPrices {
  const v = value as Partial<AiPrices> | null;
  if (
    !v ||
    typeof v.usdToEur !== 'number' ||
    v.usdToEur <= 0 ||
    typeof v.models !== 'object'
  ) {
    return DEFAULT_AI_PRICES;
  }
  return { usdToEur: v.usdToEur, models: { ...DEFAULT_AI_PRICES.models, ...v.models } };
}
