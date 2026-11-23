/**
 * Mistral, en REST (le SDK officiel est ESM uniquement, l'API est en CommonJS).
 * `mistral-ocr-*` passe par `/v1/ocr` avec une annotation de document au format du
 * schéma (un seul document par appel) ; les autres modèles par `/v1/chat/completions`
 * avec une sortie structurée (texte et images, pas de PDF).
 */

import {
  AiProviderError,
  type AiContent,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from './ai-provider';

const BASE = 'https://api.mistral.ai/v1';

export type FetchJson = (
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
) => Promise<unknown>;

export const postJson: FetchJson = async (url, apiKey, body, timeoutMs) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AiProviderError(
      `Mistral HTTP ${response.status} : ${text.slice(0, 300)}`,
      response.status,
    );
  }
  return JSON.parse(text) as unknown;
};

const isOcr = (model: string) => model.startsWith('mistral-ocr');
const dataUrl = (mimeType: string, base64: string) => `data:${mimeType};base64,${base64}`;

export class MistralProvider implements AiProvider {
  readonly id = 'mistral' as const;

  constructor(private readonly fetchJson: FetchJson = postJson) {}

  supports(model: string, content: AiContent[]): boolean {
    const documents = content.filter((c) => c.type !== 'text');
    if (isOcr(model)) return documents.length === 1;
    return !content.some((c) => c.type === 'pdf');
  }

  run(request: AiRequest, apiKey: string): Promise<AiResponse> {
    return isOcr(request.model) ? this.ocr(request, apiKey) : this.chat(request, apiKey);
  }

  private async ocr(request: AiRequest, apiKey: string): Promise<AiResponse> {
    const doc = request.content.find(
      (c): c is Exclude<AiContent, { type: 'text' }> => c.type !== 'text',
    );
    if (!doc) throw new AiProviderError('OCR sans document.');
    const extra = request.content
      .filter((c): c is Extract<AiContent, { type: 'text' }> => c.type === 'text')
      .map((c) => c.text);
    const document =
      doc.type === 'pdf'
        ? {
            type: 'document_url',
            document_url: dataUrl('application/pdf', doc.base64),
            document_name: doc.name,
          }
        : { type: 'image_url', image_url: dataUrl(doc.mimeType, doc.base64) };
    const res = (await this.fetchJson(
      `${BASE}/ocr`,
      apiKey,
      {
        model: request.model,
        document,
        document_annotation_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
        document_annotation_prompt: [request.system, ...extra].join('\n\n'),
      },
      request.timeoutMs,
    )) as {
      document_annotation?: string | null;
      usage_info?: { pages_processed?: number };
    };
    if (!res.document_annotation)
      throw new AiProviderError('Réponse OCR sans annotation.');
    return {
      text: res.document_annotation,
      inputTokens: 0,
      outputTokens: 0,
      pages: res.usage_info?.pages_processed ?? 1,
    };
  }

  private async chat(request: AiRequest, apiKey: string): Promise<AiResponse> {
    const content = request.content.map((c) =>
      c.type === 'text'
        ? { type: 'text', text: c.text }
        : {
            type: 'image_url',
            image_url: dataUrl(
              c.type === 'image' ? c.mimeType : 'application/pdf',
              c.base64,
            ),
          },
    );
    const res = (await this.fetchJson(
      `${BASE}/chat/completions`,
      apiKey,
      {
        model: request.model,
        temperature: 0,
        max_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
      },
      request.timeoutMs,
    )) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = res.choices?.[0]?.message?.content;
    if (!text) throw new AiProviderError('Réponse Mistral vide.');
    return {
      text,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      pages: 0,
    };
  }
}
