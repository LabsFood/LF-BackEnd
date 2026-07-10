import { ConfigService } from '@nestjs/config';

import { ClerkService } from './clerk.service';

const fakeConfig = (secretKey: string | undefined) =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'clerk.secretKey') return secretKey;
      return undefined;
    }),
  }) as unknown as ConfigService;

describe('ClerkService', () => {
  it('is not configured with the local stub secret', () => {
    const svc = new ClerkService(fakeConfig('sk_test_placeholder'));
    expect(svc.configured).toBe(false);
  });

  it('is configured with a real Clerk secret key', () => {
    const svc = new ClerkService(fakeConfig('sk_test_abc123XYZ'));
    expect(svc.configured).toBe(true);
  });

  it('throws when getClient is called without configuration', () => {
    const svc = new ClerkService(fakeConfig(undefined));
    expect(() => svc.getClient()).toThrow('Clerk is not configured.');
  });
});
