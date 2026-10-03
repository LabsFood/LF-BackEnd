import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient | null;
  readonly url?: string;
  readonly serviceRoleKey?: string;
  readonly anonKey?: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('supabase.url');
    this.serviceRoleKey = config.get<string>('supabase.serviceRoleKey');
    this.anonKey = config.get<string>('supabase.anonKey');
    this.client =
      this.url && this.serviceRoleKey
        ? createClient(this.url, this.serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    if (!this.client) {
      this.logger.warn(
        'Supabase is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY missing).',
      );
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase is not configured.');
    }
    return this.client;
  }
}
