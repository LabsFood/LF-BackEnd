import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseService } from './supabase.service';

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('SupabaseService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('builds the Storage client from the secret key', () => {
    const service = new SupabaseService(
      configWith({
        'supabase.url': 'https://ref.supabase.co',
        'supabase.secretKey': 'sb_secret_x',
      }),
    );
    expect(service.configured).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is not configured without the secret key', () => {
    const service = new SupabaseService(
      configWith({ 'supabase.url': 'https://ref.supabase.co' }),
    );
    expect(service.configured).toBe(false);
    expect(() => service.getClient()).toThrow('Supabase is not configured.');
  });

  it('flags legacy key variables still set in the environment', () => {
    new SupabaseService(
      configWith({
        'supabase.url': 'https://ref.supabase.co',
        'supabase.secretKey': 'sb_secret_x',
        SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy',
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY no longer read'),
    );
  });
});
