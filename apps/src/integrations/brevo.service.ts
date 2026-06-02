import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';

@Injectable()
export class BrevoService {
  readonly apiKey?: string;
  readonly senderEmail: string;
  readonly senderName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('brevo.apiKey');
    this.senderEmail = config.get<string>('brevo.senderEmail', 'noreply@labsfood.com');
    this.senderName = config.get<string>('brevo.senderName', 'Labs Food');
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  get baseUrl(): string {
    return BREVO_BASE_URL;
  }

  /** Build the auth + JSON headers Brevo's REST API expects. */
  buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.apiKey) headers['api-key'] = this.apiKey;
    return headers;
  }
}
