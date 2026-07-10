import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isRealClerkSecretKey } from '../auth/clerk-ids';

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly client: ClerkClient | null;

  constructor(config: ConfigService) {
    const secretKey = config.get<string>('clerk.secretKey');
    this.client =
      secretKey && isRealClerkSecretKey(secretKey)
        ? createClerkClient({ secretKey })
        : null;
    if (!this.client) {
      this.logger.warn(
        'Clerk Backend API is not configured (real CLERK_SECRET_KEY missing).',
      );
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  getClient(): ClerkClient {
    if (!this.client) {
      throw new Error('Clerk is not configured.');
    }
    return this.client;
  }
}
