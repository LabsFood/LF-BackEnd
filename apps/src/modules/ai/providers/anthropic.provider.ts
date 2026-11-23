/**
 * Claude, par le SDK officiel, avec sortie structurée (`output_config.format`).
 * PDF, images (JPEG, PNG, WebP, GIF) et texte. Hors UE : n'est utilisé qu'en renfort
 * si ce choix est validé (décision J2).
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  AiProviderError,
  CLAUDE_IMAGE_TYPES,
  type AiContent,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from './ai-provider';

type Body = Anthropic.MessageCreateParamsNonStreaming;
export type CreateMessage = (
  body: Body,
  apiKey: string,
  timeoutMs: number,
) => Promise<Anthropic.Message>;

const sdkCreate: CreateMessage = (body, apiKey, timeoutMs) =>
  new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }).messages.create(body);

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function block(content: AiContent): Anthropic.ContentBlockParam {
  if (content.type === 'text') return { type: 'text', text: content.text };
  if (content.type === 'pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: content.base64 },
    };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: content.mimeType as ImageType,
      data: content.base64,
    },
  };
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;

  constructor(private readonly create: CreateMessage = sdkCreate) {}

  supports(_model: string, content: AiContent[]): boolean {
    return content.every(
      (c) => c.type !== 'image' || CLAUDE_IMAGE_TYPES.includes(c.mimeType),
    );
  }

  async run(request: AiRequest, apiKey: string): Promise<AiResponse> {
    let message: Anthropic.Message;
    try {
      message = await this.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.content.map(block) }],
          output_config: {
            ...(request.effort ? { effort: request.effort } : {}),
            format: { type: 'json_schema', schema: request.schema },
          },
        },
        apiKey,
        request.timeoutMs,
      );
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new AiProviderError(
          `Anthropic HTTP ${error.status} : ${error.message}`,
          error.status,
        );
      }
      throw error;
    }
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!text) throw new AiProviderError(`Réponse Claude vide (${message.stop_reason}).`);
    return {
      text,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      pages: 0,
    };
  }
}
