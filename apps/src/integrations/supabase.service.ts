import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Legacy JWT keys, no longer read. Still set means a leaked value is still lying around. */
const LEGACY_KEY_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient | null;
  readonly url?: string;
  /** Secret API key (`sb_secret_…`): bypasses RLS, server side only. */
  readonly secretKey?: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('supabase.url');
    this.secretKey = config.get<string>('supabase.secretKey');
    this.client =
      this.url && this.secretKey
        ? createClient(this.url, this.secretKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    if (!this.client) {
      this.logger.warn(
        'Supabase is not configured (SUPABASE_URL and SUPABASE_SECRET_KEY missing).',
      );
    }
    const leftovers = LEGACY_KEY_VARS.filter((name) => config.get<string>(name));
    if (leftovers.length > 0) {
      this.logger.warn(
        `${leftovers.join(', ')} no longer read (SUPABASE_SECRET_KEY replaces them): delete from the environment.`,
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
