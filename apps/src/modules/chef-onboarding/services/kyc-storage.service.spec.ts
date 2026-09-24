import { ConfigService } from '@nestjs/config';

import { SupabaseService } from '../../../integrations/supabase.service';
import {
  ALLOWED_MIME_TYPES,
  KycStorageService,
  MAX_FILE_BYTES,
} from './kyc-storage.service';

describe('KycStorageService.assertAcceptable (FLOW-01 §3.1)', () => {
  const service = new KycStorageService(
    { configured: false } as unknown as SupabaseService,
    { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
  );

  const code = (fn: () => void): string | undefined => {
    try {
      fn();
    } catch (error) {
      return (error as { response?: { code?: string } }).response?.code;
    }
    return undefined;
  };

  it.each(ALLOWED_MIME_TYPES)('accepts %s', (mime) => {
    expect(() => service.assertAcceptable(mime, 1024)).not.toThrow();
  });

  it.each(['application/x-msdownload', 'text/html', 'application/zip', 'image/svg+xml'])(
    'refuses %s with 422 UNSUPPORTED_MEDIA_TYPE',
    (mime) => {
      expect(code(() => service.assertAcceptable(mime, 1024))).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
    },
  );

  it('accepts a file exactly at the 10 MB cap', () => {
    expect(() =>
      service.assertAcceptable('application/pdf', MAX_FILE_BYTES),
    ).not.toThrow();
  });

  it('refuses one byte over the cap with FILE_TOO_LARGE', () => {
    expect(
      code(() => service.assertAcceptable('application/pdf', MAX_FILE_BYTES + 1)),
    ).toBe('FILE_TOO_LARGE');
  });

  it.each([0, -1, 1.5])('refuses a non-positive or fractional size (%p)', (size) => {
    expect(code(() => service.assertAcceptable('application/pdf', size))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('KycStorageService.buildPath', () => {
  const service = new KycStorageService(
    { configured: false } as unknown as SupabaseService,
    { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
  );

  it('scopes every object under its owner and type', () => {
    // The owner prefix comes from authorised route params, so a candidate can only
    // ever confirm a file inside their own candidature.
    expect(service.buildPath('applications/app-1', 'identity', 'up_9')).toBe(
      'applications/app-1/identity/up_9',
    );
  });
});
