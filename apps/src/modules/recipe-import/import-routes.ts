/**
 * Import de recettes : quel modèle pour quelle source. Mistral d'abord (UE) ; Claude
 * en renfort seulement si la console l'autorise (`allowNonEuFallback`). À ajuster
 * avec les résultats du banc J2 (`npm run ai:bench:recipes`).
 */

import type { AiRoute } from '../ai/ai-gateway.service';
import type { AiContent } from '../ai/providers/ai-provider';

const OCR: AiRoute = { provider: 'mistral', model: 'mistral-ocr-latest' };
const SMALL: AiRoute = { provider: 'mistral', model: 'mistral-small-latest' };
const SONNET: AiRoute = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
};
const HAIKU: AiRoute = {
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  effort: 'low',
};

export function routesFor(content: AiContent[], allowNonEuFallback: boolean): AiRoute[] {
  const documents = content.filter((c) => c.type !== 'text');
  const eu = documents.length === 1 ? [OCR] : documents.length > 1 ? [SMALL] : [SMALL];
  const fallback = documents.length ? SONNET : HAIKU;
  return allowNonEuFallback ? [...eu, fallback] : eu;
}
