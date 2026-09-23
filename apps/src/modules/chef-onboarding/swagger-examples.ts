/**
 * Response examples for the chef-onboarding routes in Swagger. They copy the shapes
 * the services really return (`toCandidateView`, `dossier`, `toView`, …) — change
 * them together.
 */

const APPLICATION_ID = '0b8c2f1e-9d64-4c1b-8a4e-2f0d3c5a7b11';
const CHEF_PROFILE_ID = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

const IDENTITY_VALID = {
  type: 'identity',
  label: "Pièce d'identité",
  family: 'blocking',
  required: true,
  status: 'valid',
  version: 1,
  fileName: 'cni-recto-verso.pdf',
  sizeBytes: 842133,
  submittedAt: '2026-09-20T09:14:41.002Z',
  expiresOn: '2028-03-14',
  reason: null,
  reasonCode: null,
};

const REGISTRATION_REFUSED = {
  type: 'registration',
  label: "Justificatif d'immatriculation",
  family: 'blocking',
  required: true,
  status: 'rejected',
  version: 1,
  fileName: 'kbis.jpg',
  sizeBytes: 311020,
  submittedAt: '2026-09-20T09:16:02.118Z',
  expiresOn: null,
  reason:
    "L'extrait date de plus de 3 mois. Merci d'envoyer un avis de situation récent.",
  reasonCode: 'expired',
};

const RC_PRO_MISSING = {
  type: 'rc-pro',
  label: 'Assurance responsabilité civile professionnelle',
  family: 'recommended',
  required: false,
  status: 'missing',
  version: 0,
  fileName: null,
  sizeBytes: null,
  submittedAt: null,
  expiresOn: null,
  reason: null,
  reasonCode: null,
};

/** `POST /chef-applications` → 201. */
export const SUBMITTED_EXAMPLE = {
  id: APPLICATION_ID,
  reference: 'APP-2026-0042',
  status: 'submitted',
  submittedAt: '2026-09-20T09:12:03.412Z',
  decidedAt: null,
  refusal: null,
  documents: [
    {
      type: 'identity',
      label: "Pièce d'identité",
      family: 'blocking',
      required: true,
      status: 'missing',
    },
    {
      type: 'registration',
      label: "Justificatif d'immatriculation",
      family: 'blocking',
      required: true,
      status: 'missing',
    },
    {
      type: 'rc-pro',
      label: 'Assurance responsabilité civile professionnelle',
      family: 'recommended',
      required: false,
      status: 'missing',
    },
  ],
};

/** `GET /me/chef-documents` → 200. */
export const DOSSIER_EXAMPLE = {
  dossierStatus: 'incomplete',
  canApprove: false,
  documents: [IDENTITY_VALID, REGISTRATION_REFUSED, RC_PRO_MISSING],
};

/** `GET /me/chef-application` → 200, in its two most common states. */
export const MY_APPLICATION_EXAMPLES = {
  reviewing: {
    summary: 'Being reviewed',
    value: {
      ...SUBMITTED_EXAMPLE,
      ...DOSSIER_EXAMPLE,
    },
  },
  refused: {
    summary: 'Refused, with a reapply date',
    value: {
      ...SUBMITTED_EXAMPLE,
      status: 'rejected',
      decidedAt: '2026-09-25T10:04:51.000Z',
      refusal: {
        reason:
          "Zone d'intervention non couverte pour l'instant : nous ne travaillons pas encore en Corse.",
        allowReapplyAfter: '2027-01-01',
      },
      ...DOSSIER_EXAMPLE,
    },
  },
};

/** `POST /me/chef-documents/{type}/upload-url` → 201. */
export const UPLOAD_URL_EXAMPLE = {
  uploadId: 'up_9f2a1c4e7b30d85a61c2e4f7',
  method: 'PUT',
  url: 'https://<project>.supabase.co/storage/v1/object/upload/sign/labsfood-kyc/chefs/c2eebc99…/identity/up_9f2a1c4e7b30d85a61c2e4f7?token=eyJhbGciOi…',
  headers: { 'Content-Type': 'application/pdf' },
  expiresAt: '2026-09-20T11:14:00.000Z',
};

/** One deposit as `toView` returns it. */
export const DEPOSIT_EXAMPLE = {
  type: 'identity',
  label: "Pièce d'identité",
  family: 'blocking',
  status: 'submitted',
  fileName: 'cni-recto-verso.pdf',
  sizeBytes: 842133,
  submittedAt: '2026-09-20T09:14:41.002Z',
  expiresOn: '2028-03-14',
  version: 1,
  reason: null,
  reasonCode: null,
  decidedAt: null,
};

/** `GET /admin/chef-applications` → 200. */
export const QUEUE_EXAMPLE = {
  data: [
    {
      id: APPLICATION_ID,
      reference: 'APP-2026-0042',
      name: 'Marie Dupont',
      city: 'Lyon',
      status: 'submitted',
      reactivatedPendingReview: false,
      pendingDocuments: 2,
      submittedAt: '2026-09-20T09:12:03.412Z',
      waitingSinceHours: 26,
    },
  ],
  meta: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

/** `GET /admin/chef-applications/{id}` → 200. */
export const APPLICATION_DETAIL_EXAMPLE = {
  id: APPLICATION_ID,
  reference: 'APP-2026-0042',
  status: 'submitted',
  identity: {
    firstName: 'Marie',
    lastName: 'Dupont',
    email: 'marie.dupont@exemple.fr',
    phone: '+33612345678',
  },
  address: {
    street: '12 rue des Lilas',
    line2: null,
    postcode: '69003',
    city: 'Lyon',
    country: 'FR',
  },
  interventionZones: [
    {
      regionCode: '84',
      regionLabel: 'Auvergne-Rhône-Alpes',
      scope: 'cities',
      cities: [{ name: 'Lyon', dept: '69', insee: '69123' }],
    },
  ],
  workAuthorization: { status: 'eu-citizen', details: null },
  company: {
    legalForm: 'micro',
    siret: '44306184100047',
    sap: { path: 'type-a', declarationNumber: 'SAP443061841' },
  },
  consent: { privacyPolicy: true, terms: true, acceptedAt: '2026-09-20T09:12:00.000Z' },
  submittedAt: '2026-09-20T09:12:03.412Z',
  decidedAt: null,
  chefProfileId: CHEF_PROFILE_ID,
  ...DOSSIER_EXAMPLE,
};

/** `PATCH /admin/chef-applications/{id}/documents/{type}` → 200. */
export const DECISION_EXAMPLE = {
  document: {
    ...DEPOSIT_EXAMPLE,
    type: 'registration',
    label: "Justificatif d'immatriculation",
    status: 'rejected',
    reason: REGISTRATION_REFUSED.reason,
    reasonCode: 'expired',
    decidedAt: '2026-09-21T08:30:12.000Z',
    decidedBy: { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: 'Sarah Lemaire' },
  },
  dossierStatus: 'incomplete',
  canApprove: false,
};

/** `POST /admin/chef-applications/{id}/approve` → 201. */
export const APPROVED_EXAMPLE = {
  application: {
    id: APPLICATION_ID,
    status: 'approved',
    approvedAt: '2026-09-22T11:22:10.004Z',
  },
  user: {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    clerkUserId: 'user_2nGxK8abc123',
    email: 'marie.dupont@exemple.fr',
    role: 'chef',
  },
  chefProfile: {
    id: CHEF_PROFILE_ID,
    displayName: 'Marie Dupont',
    isVerified: true,
    isActive: false,
  },
};

/** Error bodies that carry a `code`, for the documented 4xx responses. */
export const errorExample = (code: string, message: string) => ({ code, message });

/** What `dossierStatus` means, in the order a dossier usually goes through. */
export const DOSSIER_STATUS_HELP =
  '`dossierStatus`, as the dossier progresses:\n' +
  '- `draft`: nothing uploaded yet.\n' +
  '- `incomplete`: a blocking document (`identity`, `registration`) is missing or refused.\n' +
  '- `reviewing`: every blocking document is in, some are not checked yet.\n' +
  '- `awaiting-registration`: all good, but the candidate has no company yet.\n' +
  '- `validated`: every blocking document is valid; `canApprove` is `true`.\n' +
  '- `suspended`: a blocking document has expired.\n' +
  '- `disabled`: an admin took the batch cooker offline.';

/** What each document `status` means, in the order a document goes through. */
export const DOCUMENT_STATUS_HELP =
  'Each document `status`: `missing` (nothing uploaded), `submitted` (waiting for an ' +
  'admin; `reviewing` means the same), `valid`, `rejected` (see `reason`, then upload ' +
  'a new version), `expiring` (valid, expires within 60 days), `expired`.';
