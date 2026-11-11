import {
  CONTRACT_TERMS,
  acceptedConsents,
  chefShops,
  contractGaps,
  mergeConsents,
  type ContractState,
} from './contract.rules';

const NOW = new Date('2026-11-25T09:00:00Z');
const dayAfter = (days: number) => new Date(NOW.getTime() + days * 24 * 3600_000);

const none: ContractState = {
  contractVersion: null,
  cgvAcceptedAt: null,
  deboursMandateAcceptedAt: null,
  earlyExecutionRequestedAt: null,
};
const all: ContractState = {
  contractVersion: CONTRACT_TERMS.version,
  cgvAcceptedAt: NOW,
  deboursMandateAcceptedAt: NOW,
  earlyExecutionRequestedAt: NOW,
};

describe('chefShops', () => {
  it('is the offer’s shopping, unless the client does it', () => {
    expect(chefShops({ shoppingIncluded: true }, { shoppingByClient: false })).toBe(true);
    expect(chefShops({ shoppingIncluded: true }, { shoppingByClient: true })).toBe(false);
    expect(chefShops({ shoppingIncluded: false }, { shoppingByClient: false })).toBe(
      false,
    );
  });
});

describe('acceptedConsents', () => {
  it('stamps each box ticked under the current version', () => {
    expect(
      acceptedConsents(
        { version: CONTRACT_TERMS.version, cgv: true, deboursMandate: true },
        NOW,
      ),
    ).toEqual({
      contractVersion: CONTRACT_TERMS.version,
      cgvAcceptedAt: NOW,
      deboursMandateAcceptedAt: NOW,
      earlyExecutionRequestedAt: null,
    });
  });

  it('counts nothing given under another version, or nothing given', () => {
    expect(
      acceptedConsents({ version: '0.9', cgv: true, earlyExecution: true }, NOW),
    ).toEqual(none);
    expect(acceptedConsents(undefined, NOW)).toEqual(none);
  });
});

describe('mergeConsents', () => {
  it('keeps the first stamp of each box and adds the new ones', () => {
    const earlier = new Date('2026-11-24T09:00:00Z');
    const kept = {
      ...none,
      contractVersion: CONTRACT_TERMS.version,
      cgvAcceptedAt: earlier,
    };
    expect(mergeConsents(kept, all)).toEqual({ ...all, cgvAcceptedAt: earlier });
    expect(mergeConsents(kept, none)).toEqual(kept);
  });
});

describe('contractGaps', () => {
  const far = {
    chefShops: false,
    startsAt: dayAfter(30),
    latestConclusion: NOW,
    bookedAt: NOW,
  };

  it('asks nothing of a booking made before the CGV V1 were in force', () => {
    const before = new Date(CONTRACT_TERMS.inForceFrom.getTime() - 1);
    expect(contractGaps(none, { ...far, chefShops: true, bookedAt: before })).toEqual([]);
    expect(contractGaps(none, { ...far, bookedAt: CONTRACT_TERMS.inForceFrom })).toEqual([
      'CGV',
    ]);
  });

  it('is in force from 21 November 2026, midnight in Paris', () => {
    expect(CONTRACT_TERMS.inForceFrom).toEqual(new Date('2026-11-20T23:00:00Z'));
  });

  it('always needs the CGV', () => {
    expect(contractGaps(none, far)).toEqual(['CGV']);
  });

  it('needs the débours mandate when the batch cooker shops', () => {
    expect(
      contractGaps({ ...none, cgvAcceptedAt: NOW }, { ...far, chefShops: true }),
    ).toEqual(['DEBOURS_MANDATE']);
  });

  it('needs the early-execution request when the prestation falls inside the 14 days', () => {
    const soon = { ...far, startsAt: dayAfter(10) };
    expect(contractGaps({ ...none, cgvAcceptedAt: NOW }, soon)).toEqual([
      'EARLY_EXECUTION',
    ]);
  });

  it('measures the 14 days from the latest the contract can be concluded', () => {
    // 16 days out is clear of a conclusion today, not of one in three days.
    const input = { ...far, startsAt: dayAfter(16) };
    expect(contractGaps({ ...none, cgvAcceptedAt: NOW }, input)).toEqual([]);
    expect(
      contractGaps(
        { ...none, cgvAcceptedAt: NOW },
        { ...input, latestConclusion: dayAfter(3) },
      ),
    ).toEqual(['EARLY_EXECUTION']);
  });

  it('is satisfied when every box needed is ticked', () => {
    expect(contractGaps(all, { ...far, chefShops: true, startsAt: dayAfter(2) })).toEqual(
      [],
    );
  });
});
