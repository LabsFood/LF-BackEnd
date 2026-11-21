import type Anthropic from '@anthropic-ai/sdk';

import type { AiRequest } from './ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { MistralProvider } from './mistral.provider';

const request = (over: Partial<AiRequest>): AiRequest => ({
  model: 'mistral-small-latest',
  system: 'consigne',
  content: [{ type: 'text', text: 'recette' }],
  schema: { type: 'object' },
  schemaName: 'recipe_extraction',
  maxTokens: 1000,
  timeoutMs: 1000,
  ...over,
});

describe('MistralProvider', () => {
  it('envoie un PDF à /v1/ocr avec une annotation au format du schéma', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const provider = new MistralProvider((url, _key, body) => {
      calls.push({ url, body: body as Record<string, unknown> });
      return Promise.resolve({
        document_annotation: '{"recipes":[]}',
        usage_info: { pages_processed: 2 },
      });
    });
    const pdf = [{ type: 'pdf' as const, base64: 'QQ==', name: 'a.pdf' }];
    expect(provider.supports('mistral-ocr-latest', pdf)).toBe(true);
    const res = await provider.run(
      request({ model: 'mistral-ocr-latest', content: pdf }),
      'k',
    );
    expect(res).toEqual({
      text: '{"recipes":[]}',
      inputTokens: 0,
      outputTokens: 0,
      pages: 2,
    });
    expect(calls[0].url).toBe('https://api.mistral.ai/v1/ocr');
    expect(calls[0].body).toMatchObject({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        document_url: 'data:application/pdf;base64,QQ==',
      },
      document_annotation_format: {
        type: 'json_schema',
        json_schema: { name: 'recipe_extraction', strict: true },
      },
      document_annotation_prompt: 'consigne',
    });
  });

  it('passe une image au chat avec une sortie structurée, et refuse un PDF en chat', async () => {
    let body: Record<string, unknown> = {};
    const provider = new MistralProvider((_url, _key, b) => {
      body = b as Record<string, unknown>;
      return Promise.resolve({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const image = [{ type: 'image' as const, mimeType: 'image/png', base64: 'QQ==' }];
    const res = await provider.run(request({ content: image }), 'k');
    expect(res).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(body).toMatchObject({
      response_format: { type: 'json_schema' },
      messages: [
        { role: 'system' },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: 'data:image/png;base64,QQ==' }],
        },
      ],
    });
    expect(
      provider.supports('mistral-small-latest', [{ type: 'pdf', base64: '', name: 'a' }]),
    ).toBe(false);
  });
});

describe('AnthropicProvider', () => {
  it('demande une sortie structurée et lit les jetons', async () => {
    let sent: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const provider = new AnthropicProvider((body) => {
      sent = body;
      return Promise.resolve({
        content: [{ type: 'text', text: '{"recipes":[]}' }],
        usage: { input_tokens: 100, output_tokens: 20 },
        stop_reason: 'end_turn',
      } as unknown as Anthropic.Message);
    });
    const res = await provider.run(
      request({
        model: 'claude-haiku-5-5',
        effort: 'low',
        content: [{ type: 'pdf', base64: 'QQ==', name: 'a.pdf' }],
      }),
      'k',
    );
    expect(res).toEqual({
      text: '{"recipes":[]}',
      inputTokens: 100,
      outputTokens: 20,
      pages: 0,
    });
    expect(sent).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      messages: [
        {
          role: 'user',
          content: [{ type: 'document', source: { media_type: 'application/pdf' } }],
        },
      ],
    });
    expect(
      provider.supports('x', [{ type: 'image', mimeType: 'image/heic', base64: '' }]),
    ).toBe(false);
  });
});
