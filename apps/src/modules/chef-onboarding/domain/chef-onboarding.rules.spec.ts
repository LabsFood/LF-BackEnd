import {
  ChefDocumentStatus,
  ChefDocumentType,
  CompanyLegalForm,
  WorkAuthorizationStatus,
} from '../../../generated/prisma/client';
import {
  ApplicationAnswers,
  expiryNoticeThreshold,
  buildApplicationReference,
  canApprove,
  deriveDossierStatus,
  DossierDocument,
  fromWire,
  isValidPostcode,
  isValidSapDeclarationNumber,
  isValidSiret,
  requiredDocuments,
  toWire,
} from './chef-onboarding.rules';

const answers = (over: Partial<ApplicationAnswers> = {}): ApplicationAnswers => ({
  workAuthorizationStatus: WorkAuthorizationStatus.eu_citizen,
  companyLegalForm: CompanyLegalForm.micro,
  sapPath: 'type_b',
  ...over,
});

const types = (a: ApplicationAnswers): ChefDocumentType[] =>
  requiredDocuments(a).map((r) => r.type);

describe('requiredDocuments (FLOW-01 §2)', () => {
  it('reproduces the example response of the flow document exactly', () => {
    // Marie Dupont: work authorisation "other", micro-entreprise, SAP type-a.
    const list = requiredDocuments(
      answers({
        workAuthorizationStatus: WorkAuthorizationStatus.other,
        companyLegalForm: CompanyLegalForm.micro,
        sapPath: 'type_a',
      }),
    );

    expect(
      list.map((r) => ({ type: toWire(r.type), family: r.family, required: r.required })),
    ).toEqual([
      { type: 'identity', family: 'blocking', required: true },
      { type: 'status-proof', family: 'conditional', required: false },
      { type: 'registration', family: 'blocking', required: true },
      { type: 'sap-declaration', family: 'conditional', required: false },
      { type: 'rc-pro', family: 'recommended', required: false },
      { type: 'haccp', family: 'recommended', required: false },
      { type: 'ddpp', family: 'recommended', required: false },
    ]);
  });

  it.each([
    [WorkAuthorizationStatus.residence_permit, ChefDocumentType.residence_permit],
    [WorkAuthorizationStatus.renewal_pending, ChefDocumentType.renewal_receipt],
    [WorkAuthorizationStatus.other, ChefDocumentType.status_proof],
  ])('adds the conditional proof demanded by %s', (status, expected) => {
    expect(types(answers({ workAuthorizationStatus: status }))).toContain(expected);
  });

  it('asks an EU citizen for no extra status proof — the identity document covers it', () => {
    const list = types(
      answers({ workAuthorizationStatus: WorkAuthorizationStatus.eu_citizen }),
    );
    expect(list).toContain(ChefDocumentType.identity);
    expect(list).not.toContain(ChefDocumentType.status_proof);
    expect(list).not.toContain(ChefDocumentType.residence_permit);
    expect(list).not.toContain(ChefDocumentType.renewal_receipt);
  });

  it('does not ask an unregistered candidate for a registration certificate', () => {
    expect(
      types(answers({ companyLegalForm: CompanyLegalForm.not_registered })),
    ).not.toContain(ChefDocumentType.registration);
  });

  it.each([CompanyLegalForm.micro, CompanyLegalForm.other_company])(
    'requires registration for %s',
    (legalForm) => {
      expect(types(answers({ companyLegalForm: legalForm }))).toContain(
        ChefDocumentType.registration,
      );
    },
  );

  it('asks for the SAP receipt only on the type-a route', () => {
    expect(types(answers({ sapPath: 'type_a' }))).toContain(
      ChefDocumentType.sap_declaration,
    );
    expect(types(answers({ sapPath: 'type_b' }))).not.toContain(
      ChefDocumentType.sap_declaration,
    );
  });

  it('always recommends the three optional documents', () => {
    const list = types(answers());
    expect(list).toEqual(
      expect.arrayContaining([
        ChefDocumentType.rc_pro,
        ChefDocumentType.haccp,
        ChefDocumentType.ddpp,
      ]),
    );
  });

  it('marks only blocking documents as required', () => {
    for (const req of requiredDocuments(answers({ sapPath: 'type_a' }))) {
      expect(req.required).toBe(req.family === 'blocking');
    }
  });
});

describe('deriveDossierStatus (FLOW-01 §5.3)', () => {
  const doc = (type: ChefDocumentType, status: ChefDocumentStatus): DossierDocument => ({
    type,
    status,
  });
  // Blocking set for a registered micro-entrepreneur: identity + registration.
  const registered = answers();
  const valid = ChefDocumentStatus.valid;

  it('is draft when nothing has been deposited', () => {
    expect(deriveDossierStatus([], { answers: registered })).toBe('draft');
  });

  it('is disabled when an admin turned the account off, whatever the documents say', () => {
    const all = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.registration, valid),
    ];
    expect(deriveDossierStatus(all, { answers: registered, disabled: true })).toBe(
      'disabled',
    );
  });

  it('is incomplete while a blocking document is missing', () => {
    expect(
      deriveDossierStatus([doc(ChefDocumentType.identity, valid)], {
        answers: registered,
      }),
    ).toBe('incomplete');
  });

  it('is incomplete when a blocking document was rejected', () => {
    const docs = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.registration, ChefDocumentStatus.rejected),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('incomplete');
  });

  it('is reviewing once every blocking document is deposited and one awaits a decision', () => {
    const docs = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.registration, ChefDocumentStatus.submitted),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('reviewing');
  });

  it('is validated when every blocking document is valid', () => {
    const docs = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.registration, valid),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('validated');
  });

  it('treats expiring as still valid — the document has not lapsed yet', () => {
    const docs = [
      doc(ChefDocumentType.identity, ChefDocumentStatus.expiring),
      doc(ChefDocumentType.registration, valid),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('validated');
  });

  it('is suspended as soon as a blocking document expires', () => {
    const docs = [
      doc(ChefDocumentType.identity, ChefDocumentStatus.expired),
      doc(ChefDocumentType.registration, valid),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('suspended');
  });

  it('ignores an expired recommended document — only blocking ones suspend', () => {
    const docs = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.registration, valid),
      doc(ChefDocumentType.rc_pro, ChefDocumentStatus.expired),
    ];
    expect(deriveDossierStatus(docs, { answers: registered })).toBe('validated');
  });

  it('is awaiting-registration when all is well but the candidate has no company', () => {
    const unregistered = answers({ companyLegalForm: CompanyLegalForm.not_registered });
    const docs = [doc(ChefDocumentType.identity, valid)];
    expect(deriveDossierStatus(docs, { answers: unregistered })).toBe(
      'awaiting_registration',
    );
  });

  it('never lets an unregistered candidate reach validated', () => {
    const unregistered = answers({ companyLegalForm: CompanyLegalForm.not_registered });
    const docs = [
      doc(ChefDocumentType.identity, valid),
      doc(ChefDocumentType.rc_pro, valid),
      doc(ChefDocumentType.haccp, valid),
    ];
    expect(canApprove(deriveDossierStatus(docs, { answers: unregistered }))).toBe(false);
  });

  it('only allows approval from validated', () => {
    expect(canApprove('validated')).toBe(true);
    for (const status of [
      'draft',
      'awaiting_registration',
      'incomplete',
      'reviewing',
      'suspended',
      'disabled',
    ] as const) {
      expect(canApprove(status)).toBe(false);
    }
  });
});

describe('isValidSiret', () => {
  it('accepts the SIRET used in the flow document', () => {
    expect(isValidSiret('44306184100047')).toBe(true);
  });

  it('rejects a 14-digit number that fails the Luhn checksum', () => {
    expect(isValidSiret('44306184100048')).toBe(false);
  });

  it.each(['', '1234567890123', '123456789012345', '4430618410004a', '443 0618 4100047'])(
    'rejects malformed input %p',
    (value) => {
      expect(isValidSiret(value)).toBe(false);
    },
  );
});

describe('isValidPostcode (metropolitan France, Corsica included)', () => {
  it.each(['69003', '01000', '95999', '20000', '75001'])('accepts %s', (value) => {
    expect(isValidPostcode(value)).toBe(true);
  });

  it.each(['97400', '98000', '00999', '9500', 'ABCDE', ''])('rejects %s', (value) => {
    expect(isValidPostcode(value)).toBe(false);
  });
});

describe('isValidSapDeclarationNumber', () => {
  it('accepts the documented format', () => {
    expect(isValidSapDeclarationNumber('SAP443061841')).toBe(true);
  });

  it.each(['SAP44306184', 'SAP4430618411', 'sap443061841', '443061841', ''])(
    'rejects %p',
    (value) => {
      expect(isValidSapDeclarationNumber(value)).toBe(false);
    },
  );
});

describe('buildApplicationReference', () => {
  it('pads the sequence to four digits', () => {
    expect(buildApplicationReference(2026, 42)).toBe('APP-2026-0042');
  });

  it('does not truncate a sequence past four digits', () => {
    expect(buildApplicationReference(2026, 12345)).toBe('APP-2026-12345');
  });
});

describe('wire format mapping', () => {
  it('round-trips every enum value used on the wire', () => {
    for (const value of [
      'status_proof',
      'sap_declaration',
      'rc_pro',
      'residence_permit',
      'eu_citizen',
      'other_company',
      'not_registered',
      'type_a',
      'awaiting_registration',
    ]) {
      expect(fromWire(toWire(value))).toBe(value);
    }
  });

  it('produces the kebab-case the flow document specifies', () => {
    expect(toWire('sap_declaration')).toBe('sap-declaration');
    expect(fromWire('not-registered')).toBe('not_registered');
  });
});

describe('expiryNoticeThreshold (FLOW-01 §7)', () => {
  it.each([
    [90, undefined],
    [61, undefined],
    [60, 60],
    [59, 60],
    [31, 60],
    [30, 30],
    [29, 30],
    [8, 30],
    [7, 7],
    [6, 7],
    [1, 7],
    [0, 7],
  ])('with %i days left sends the %p notice', (daysLeft, expected) => {
    // Always the tightest threshold crossed, never the widest.
    expect(expiryNoticeThreshold(daysLeft)).toBe(expected);
  });
});
