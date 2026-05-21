import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StreamService {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly appId?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('stream.apiKey');
    this.apiSecret = config.get<string>('stream.apiSecret');
    this.appId = config.get<string>('stream.appId');
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }
}
