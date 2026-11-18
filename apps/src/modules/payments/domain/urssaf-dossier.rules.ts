/**
 * What URSSAF asks of a client before the immediate advance (API "tiers de
 * prestation", method 010, `InputParticulierDTO`), collected by the site and entered
 * by an admin on the intermediary's space while the API access is pending.
 *
 * Pure: shape and cross-field checks only. Nothing here is logged.
 */

export const FRANCE_INSEE = '99100';

export interface UrssafDossier {
  civility: 'M' | 'F';
  birthName: string;
  usageName?: string | null;
  firstNames: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  /** INSEE country code, `99100` for France. */
  birthCountryCode: string;
  /** Birth in France only: `075`, `02A`, `971`. */
  birthDepartmentCode?: string | null;
  /** Birth in France only: INSEE commune code (`75056`, `2A004`). */
  birthCommuneCode?: string | null;
  birthCommuneName?: string | null;
  mobilePhone: string;
  email: string;
  address: {
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    countryCode: string;
  };
  iban: string;
  bic: string;
  accountHolder: string;
}

export interface DossierProblem {
  field: string;
  code: string;
}

const NAME = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
const MOBILE = /^(?:0|\+33)[67]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEPARTMENT = /^(?:0\d{2}|02[AB]|97[1-6])$/;
const COMMUNE = /^(?:\d{5}|2[AB]\d{3})$/;
const COUNTRY = /^99\d{3}$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const BIC = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

const compact = (value: string) => value.replace(/[\s.-]/g, '');

export function normalizeDossier(d: UrssafDossier): UrssafDossier {
  const trim = (v: string | null | undefined) => v?.trim() || null;
  return {
    ...d,
    birthName: d.birthName.trim(),
    usageName: trim(d.usageName),
    firstNames: d.firstNames.trim(),
    birthDepartmentCode: trim(d.birthDepartmentCode)?.toUpperCase() ?? null,
    birthCommuneCode: trim(d.birthCommuneCode)?.toUpperCase() ?? null,
    birthCommuneName: trim(d.birthCommuneName),
    mobilePhone: compact(d.mobilePhone),
    email: d.email.trim().toLowerCase(),
    address: {
      line1: d.address.line1.trim(),
      line2: trim(d.address.line2),
      postalCode: d.address.postalCode.trim(),
      city: d.address.city.trim(),
      countryCode: d.address.countryCode.trim(),
    },
    iban: d.iban.replace(/\s/g, '').toUpperCase(),
    bic: d.bic.replace(/\s/g, '').toUpperCase(),
    accountHolder: d.accountHolder.trim(),
  };
}

/** ISO 13616 mod-97 check: the rearranged IBAN, letters as numbers, leaves 1. */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

export const ibanLast4 = (iban: string) => iban.slice(-4);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(value) &&
    date.getUTCFullYear() >= 1900 &&
    date.getTime() < Date.now()
  );
}

/** Takes a normalised dossier; returns every problem, empty when it can be entered. */
export function dossierProblems(d: UrssafDossier): DossierProblem[] {
  const problems: DossierProblem[] = [];
  const flag = (field: string, code: string) => problems.push({ field, code });

  if (!NAME.test(d.birthName)) flag('birthName', 'INVALID_NAME');
  if (d.usageName && !NAME.test(d.usageName)) flag('usageName', 'INVALID_NAME');
  if (!NAME.test(d.firstNames)) flag('firstNames', 'INVALID_NAME');
  if (!validDate(d.birthDate)) flag('birthDate', 'INVALID_DATE');

  if (!COUNTRY.test(d.birthCountryCode)) {
    flag('birthCountryCode', 'INVALID_COUNTRY');
  } else if (d.birthCountryCode === FRANCE_INSEE) {
    const dep = d.birthDepartmentCode;
    const commune = d.birthCommuneCode;
    if (!dep) flag('birthDepartmentCode', 'REQUIRED');
    else if (!DEPARTMENT.test(dep)) flag('birthDepartmentCode', 'INVALID_DEPARTMENT');
    if (!commune) flag('birthCommuneCode', 'REQUIRED');
    else if (!COMMUNE.test(commune)) flag('birthCommuneCode', 'INVALID_COMMUNE');
    else if (dep && DEPARTMENT.test(dep)) {
      // `075` → communes `75…`; overseas `971` → `971…`.
      const prefix = dep.startsWith('97') ? dep : dep.slice(1);
      if (!commune.startsWith(prefix)) {
        flag('birthCommuneCode', 'COMMUNE_NOT_IN_DEPARTMENT');
      }
    }
    if (!d.birthCommuneName) flag('birthCommuneName', 'REQUIRED');
  } else {
    // URSSAF refuses a department or commune for a birth abroad.
    if (d.birthDepartmentCode) flag('birthDepartmentCode', 'NOT_FOR_BIRTH_ABROAD');
    if (d.birthCommuneCode) flag('birthCommuneCode', 'NOT_FOR_BIRTH_ABROAD');
    if (d.birthCommuneName) flag('birthCommuneName', 'NOT_FOR_BIRTH_ABROAD');
  }

  if (!MOBILE.test(d.mobilePhone)) flag('mobilePhone', 'INVALID_MOBILE');
  if (!EMAIL.test(d.email)) flag('email', 'INVALID_EMAIL');

  if (!d.address.line1) flag('address.line1', 'REQUIRED');
  if (!d.address.city) flag('address.city', 'REQUIRED');
  if (!COUNTRY.test(d.address.countryCode))
    flag('address.countryCode', 'INVALID_COUNTRY');
  else if (
    d.address.countryCode === FRANCE_INSEE &&
    !/^\d{5}$/.test(d.address.postalCode)
  ) {
    flag('address.postalCode', 'INVALID_POSTAL_CODE');
  }

  if (!IBAN.test(d.iban) || !ibanChecksumOk(d.iban)) flag('iban', 'INVALID_IBAN');
  if (!BIC.test(d.bic)) flag('bic', 'INVALID_BIC');
  if (!d.accountHolder) flag('accountHolder', 'REQUIRED');

  return problems;
}
