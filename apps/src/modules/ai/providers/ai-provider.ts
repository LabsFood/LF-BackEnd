/**
 * Budget IA (DAT 6 bis) : l'interface commune des fournisseurs. Un fournisseur ne
 * connaît ni budget ni étiquette : seul `AiGateway` l'appelle, après ses contrôles.
 */

import type { AiProviderId } from '../domain/ai-prices.rules';

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string }
  | { type: 'pdf'; base64: string; name: string };

export interface AiRequest {
  model: string;
  system: string;
  content: AiContent[];
  /** Schéma JSON strict de la réponse. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  timeoutMs: number;
  /** Claude seulement. */
  effort?: 'low' | 'medium' | 'high';
}

export interface AiResponse {
  /** Le JSON rendu, en texte. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** Le modèle sait-il lire ce contenu ? */
  supports(model: string, content: AiContent[]): boolean;
  run(request: AiRequest, apiKey: string): Promise<AiResponse>;
}

export const CLAUDE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Une erreur du fournisseur, avec le statut HTTP quand il y en a un. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
