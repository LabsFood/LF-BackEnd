/**
 * Import de recettes par IA (plan J2) : les fournisseurs comparés par le banc.
 * Volontairement sans gateway, budget ni repli : chaque modèle est appelé seul, avec
 * les mêmes clients que `AiGateway`, pour mesurer ce qu'il sait faire.
 */

import {
  costMicroEur,
  DEFAULT_AI_PRICES,
  type AiProviderId,
} from '../../ai/domain/ai-prices.rules';
import type { AiContent, AiProvider } from '../../ai/providers/ai-provider';
import { AnthropicProvider } from '../../ai/providers/anthropic.provider';
import { MistralProvider } from '../../ai/providers/mistral.provider';
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SCHEMA_NAME,
  extractionPrompt,
} from '../extraction/schema';

/** Le type de source, déduit du sous-dossier de la fiche. */
export type SourceKind = 'pdf' | 'notes' | 'livre' | 'texte';

export interface SourceFile {
  name: string;
  kind: SourceKind;
  mimeType: string;
  data: Buffer;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
}

export interface Provider {
  id: string;
  supports(file: SourceFile): boolean;
  extract(file: SourceFile): Promise<ProviderResult>;
  /** Coût en dollars d'un appel. */
  cost(result: ProviderResult): number;
}

export type Effort = 'low' | 'medium' | 'high';

export function contentOf(file: SourceFile): AiContent[] {
  if (file.mimeType === 'application/pdf') {
    return [{ type: 'pdf', base64: file.data.toString('base64'), name: file.name }];
  }
  if (file.mimeType.startsWith('image/')) {
    return [
      { type: 'image', mimeType: file.mimeType, base64: file.data.toString('base64') },
    ];
  }
  return [{ type: 'text', text: file.data.toString('utf8') }];
}

const MODELS = {
  'mistral-ocr': { provider: 'mistral', model: 'mistral-ocr-latest' },
  'mistral-small': { provider: 'mistral', model: 'mistral-small-latest' },
  'claude-haiku': { provider: 'anthropic', model: 'claude-haiku-5-5' },
  'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  'claude-opus': { provider: 'anthropic', model: 'claude-opus-5-5' },
} as const satisfies Record<string, { provider: AiProviderId; model: string }>;

export type ProviderId = keyof typeof MODELS;
export const PROVIDER_IDS = Object.keys(MODELS) as ProviderId[];

function key(provider: AiProviderId): string {
  const base = `${provider.toUpperCase()}_API_KEY`;
  const value = process.env[`${base}_RECETTES`] || process.env[base];
  if (!value) throw new Error(`Clé absente : définir ${base}_RECETTES (ou ${base}).`);
  return value;
}

/** Un modèle du banc, au-dessus du client commun. */
export function benchProvider(
  id: ProviderId,
  effort: Effort,
  client?: AiProvider,
): Provider {
  const spec = MODELS[id];
  const ai =
    client ??
    (spec.provider === 'mistral' ? new MistralProvider() : new AnthropicProvider());
  return {
    id,
    supports: (file) => ai.supports(spec.model, contentOf(file)),
    extract: (file) =>
      ai.run(
        {
          model: spec.model,
          system: extractionPrompt(),
          content: contentOf(file),
          schema: EXTRACTION_SCHEMA,
          schemaName: EXTRACTION_SCHEMA_NAME,
          maxTokens: 16_000,
          timeoutMs: 120_000,
          effort: spec.provider === 'anthropic' ? effort : undefined,
        },
        key(spec.provider),
      ),
    // Les prix par défaut du budget IA, en dollars (taux 1).
    cost: (r) =>
      costMicroEur({ ...DEFAULT_AI_PRICES, usdToEur: 1 }, spec.provider, spec.model, r) /
      1_000_000,
  };
}
