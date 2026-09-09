import {
  isPlaceholderClerkUserId,
  isRealClerkSecretKey,
  isRealClerkUserId,
  splitFullName,
} from './clerk-ids';

describe('clerk-ids', () => {
  it('detects real Clerk user ids', () => {
    expect(isRealClerkUserId('user_2abcXYZ123')).toBe(true);
    expect(isRealClerkUserId('demo_seed_client_01')).toBe(false);
  });

  it('flags demo and non-Clerk ids as placeholders', () => {
    expect(isPlaceholderClerkUserId('demo_seed_client_01')).toBe(true);
    expect(isPlaceholderClerkUserId('local_stub_1')).toBe(true);
    expect(isPlaceholderClerkUserId('user_2abcXYZ123')).toBe(false);
  });

  it('detects real Clerk secret keys', () => {
    expect(isRealClerkSecretKey('sk_test_placeholder')).toBe(false);
    expect(isRealClerkSecretKey('sk_test_abc123XYZ')).toBe(true);
  });

  it('splits full names for Clerk createUser', () => {
    expect(splitFullName('Ada Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(splitFullName('Prince')).toEqual({ firstName: 'Prince' });
  });
});
