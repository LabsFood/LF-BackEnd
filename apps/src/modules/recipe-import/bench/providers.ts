/**
 * Import de recettes par IA (plan J2) : les fournisseurs comparés par le banc.
 * Volontairement sans repli ni gateway : chaque modèle est appelé seul, pour mesurer
 * ce qu'il sait faire. Mistral est appelé en REST (son SDK est ESM uniquement, l'API
 * est en CommonJS). Prix relevés le 21/11/2026, à revérifier avant de conclure.
 */

import Anthropic from '@anthropic-ai/sdk';

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

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const isPdf = (f: SourceFile) => f.mimeType === 'application/pdf';
const isImage = (f: SourceFile) => IMAGE_TYPES.includes(f.mimeType);
const isText = (f: SourceFile) => f.mimeType.startsWith('text/');
const dataUrl = (f: SourceFile) =>
  `data:${f.mimeType};base64,${f.data.toString('base64')}`;
const perMillion = (tokens: number, price: number) => (tokens / 1_000_000) * price;

const TIMEOUT_MS = 120_000;

function key(name: string, fallback: string): string {
  const value = process.env[name] ?? process.env[fallback];
  if (!value) throw new Error(`Clé absente : définir ${name} (ou ${fallback}).`);
  return value;
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} : ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

const MISTRAL = 'https://api.mistral.ai/v1';

/** Mistral OCR 4.1 + annotation de document au format du schéma. */
export function mistralOcr(fetchJson = postJson): Provider {
  return {
    id: 'mistral-ocr',
    supports: (f) => isPdf(f) || isImage(f),
    async extract(file) {
      const document = isPdf(file)
        ? { type: 'document_url', document_url: dataUrl(file), document_name: file.name }
        : { type: 'image_url', image_url: dataUrl(file) };
      const res = (await fetchJson(
        `${MISTRAL}/ocr`,
        key('MISTRAL_API_KEY_RECETTES', 'MISTRAL_API_KEY'),
        {
          model: 'mistral-ocr-latest',
          document,
          document_annotation_format: {
            type: 'json_schema',
            json_schema: {
              name: EXTRACTION_SCHEMA_NAME,
              schema: EXTRACTION_SCHEMA,
              strict: true,
            },
          },
          document_annotation_prompt: extractionPrompt(),
        },
      )) as {
        document_annotation?: string | null;
        usage_info?: { pages_processed?: number };
      };
      if (!res.document_annotation)
        throw new Error('Réponse OCR sans document_annotation.');
      return {
        text: res.document_annotation,
        inputTokens: 0,
        outputTokens: 0,
        pages: res.usage_info?.pages_processed ?? 1,
      };
    },
    // OCR + annotations : environ 5 $ pour 1 000 pages.
    cost: (r) => r.pages * 0.005,
  };
}

/** Mistral Small 4 en chat, sortie structurée ; texte et images. */
export function mistralSmall(fetchJson = postJson): Provider {
  return {
    id: 'mistral-small',
    supports: (f) => isText(f) || isImage(f),
    async extract(file) {
      const content = isText(file)
        ? [{ type: 'text', text: file.data.toString('utf8') }]
        : [{ type: 'image_url', image_url: dataUrl(file) }];
      const res = (await fetchJson(
        `${MISTRAL}/chat/completions`,
        key('MISTRAL_API_KEY_RECETTES', 'MISTRAL_API_KEY'),
        {
          model: 'mistral-small-latest',
          temperature: 0,
          max_tokens: 8000,
          messages: [
            { role: 'system', content: extractionPrompt() },
            { role: 'user', content },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: EXTRACTION_SCHEMA_NAME,
              schema: EXTRACTION_SCHEMA,
              strict: true,
            },
          },
        },
      )) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = res.choices?.[0]?.message?.content;
      if (!text) throw new Error('Réponse chat vide.');
      return {
        text,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        pages: 0,
      };
    },
    cost: (r) => perMillion(r.inputTokens, 0.15) + perMillion(r.outputTokens, 0.6),
  };
}

const CLAUDE_MODELS = {
  'claude-haiku': { model: 'claude-haiku-5-5', input: 0.1, output: 0.5 },
  'claude-sonnet': { model: 'claude-sonnet-5-5', input: 2, output: 10 },
  'claude-opus': { model: 'claude-opus-5-5', input: 4, output: 20 },
} as const;

export type ClaudeId = keyof typeof CLAUDE_MODELS;

type MessagesCreate = Anthropic['messages']['create'];

/** Claude avec sortie structurée ; PDF, images et texte en entrée. */
export function claude(
  id: ClaudeId,
  effort: Effort = 'medium',
  create?: (body: Parameters<MessagesCreate>[0]) => Promise<Anthropic.Message>,
): Provider {
  const spec = CLAUDE_MODELS[id];
  const send =
    create ??
    ((body: Parameters<MessagesCreate>[0]) =>
      new Anthropic({
        apiKey: key('ANTHROPIC_API_KEY_RECETTES', 'ANTHROPIC_API_KEY'),
        timeout: TIMEOUT_MS,
        maxRetries: 1,
      }).messages.create({ ...body, stream: false }));
  return {
    id,
    supports: (f) => isPdf(f) || isImage(f) || isText(f),
    async extract(file) {
      const source: Anthropic.ContentBlockParam = isPdf(file)
        ? {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: file.data.toString('base64'),
            },
          }
        : isImage(file)
          ? {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.mimeType as
                  'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: file.data.toString('base64'),
              },
            }
          : { type: 'text', text: file.data.toString('utf8') };
      const message = await send({
        model: spec.model,
        max_tokens: 16000,
        system: extractionPrompt(),
        messages: [{ role: 'user', content: [source] }],
        output_config: {
          effort,
          format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
        },
      });
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      if (!text) throw new Error(`Réponse vide (stop_reason ${message.stop_reason}).`);
      return {
        text,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        pages: 0,
      };
    },
    cost: (r) =>
      perMillion(r.inputTokens, spec.input) + perMillion(r.outputTokens, spec.output),
  };
}

export const PROVIDER_IDS = [
  'mistral-ocr',
  'mistral-small',
  'claude-haiku',
  'claude-sonnet',
  'claude-opus',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function providerFor(id: ProviderId, effort: Effort): Provider {
  if (id === 'mistral-ocr') return mistralOcr();
  if (id === 'mistral-small') return mistralSmall();
  return claude(id, effort);
}
