import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CronofyService {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly dataCenter: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('cronofy.clientId');
    this.clientSecret = config.get<string>('cronofy.clientSecret');
    this.dataCenter = config.get<string>('cronofy.dataCenter', 'us');
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Build the regional Cronofy API base URL from the configured data center. */
  get baseUrl(): string {
    const dc = (this.dataCenter ?? '').trim() || 'us';
    const prefix = dc === 'us' ? '' : `${dc}-`;
    return `https://api-${prefix}cronofy.com/v1`;
  }
}
