import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';

@Injectable()
export class BrevoService {
  readonly apiKey?: string;
  readonly senderEmail: string;
  readonly senderName: string;

  /** Load Brevo API key and sender identity from typed config. */
  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('brevo.apiKey');
    this.senderEmail = config.get<string>(
      'brevo.senderEmail',
      'noreply@example.com',
    );
    this.senderName = config.get<string>('brevo.senderName', 'Labs Food');
  }

  /** Whether a Brevo API key was provided via env. */
  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Fixed Brevo v3 API base URL used by the future HTTP client. */
  get baseUrl(): string {
    return BREVO_BASE_URL;
  }
}
