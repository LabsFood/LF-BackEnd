/**
 * Import de recettes : quel modèle pour quelle source. Mistral d'abord (UE) ; Claude
 * en renfort seulement si la console l'autorise (`allowNonEuFallback`).
 *
 * Banc J2 du 23/11/2026 (10 captures Notes, 1 PDF) : sur les captures, Mistral Small
 * relie 86 % des ingrédients et rend toujours les étapes ; Mistral OCR 82 % et oublie
 * les étapes sur 4 captures sur 10. Small ne lit pas les PDF : un PDF (toujours seul
 * dans un import) passe par l'OCR. En renfort, Haiku fait jeu égal avec Sonnet
 * (84 % contre 83 %) pour environ 18 fois moins cher.
 */

import type { AiRoute } from '../ai/ai-gateway.service';
import type { AiContent } from '../ai/providers/ai-provider';

const OCR: AiRoute = { provider: 'mistral', model: 'mistral-ocr-latest' };
const SMALL: AiRoute = { provider: 'mistral', model: 'mistral-small-latest' };
const HAIKU: AiRoute = {
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  effort: 'low',
};

export function routesFor(content: AiContent[], allowNonEuFallback: boolean): AiRoute[] {
  const eu = content.some((c) => c.type === 'pdf') ? OCR : SMALL;
  return allowNonEuFallback ? [eu, HAIKU] : [eu];
}
