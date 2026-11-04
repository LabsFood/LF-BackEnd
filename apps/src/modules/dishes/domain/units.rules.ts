/**
 * The fixed units of a recipe line (Recettes §4.12) and how a quantity in each is
 * shown. Rounding is for display only: sums are computed on exact quantities.
 */

export interface Unit {
  code: string;
  label: string;
  plural: string;
}

const unit = (code: string, label: string, plural = label): Unit => ({
  code,
  label,
  plural,
});

export const UNITS: readonly Unit[] = [
  unit('g', 'g'),
  unit('kg', 'kg'),
  unit('ml', 'ml'),
  unit('cl', 'cl'),
  unit('l', 'l'),
  unit('tsp', 'c. à café'),
  unit('tbsp', 'c. à soupe'),
  unit('piece', 'pièce', 'pièces'),
  unit('clove', 'gousse', 'gousses'),
  unit('bunch', 'botte', 'bottes'),
  unit('slice', 'tranche', 'tranches'),
  unit('leaf', 'feuille', 'feuilles'),
  unit('pinch', 'pincée', 'pincées'),
  unit('to_taste', 'selon le goût'),
];

export const UNIT_CODES = UNITS.map((u) => u.code);

/** Counted in whole units: always the next whole one up. */
const WHOLE = new Set(['piece', 'clove', 'bunch', 'slice', 'leaf', 'pinch']);

/** EPSILON so 1.005 rounds to 1.01, not 1. */
const roundTo = (qty: number, step: number) =>
  Math.round((qty + Number.EPSILON) / step) * step;

const decimals = (qty: number, places: number) => {
  const factor = 10 ** places;
  return Math.round((qty + Number.EPSILON) * factor) / factor;
};

/** Recettes §4.12: a quantity as shown, whatever the unit's own rounding. */
export function roundForDisplay(qty: number, unitCode: string): number {
  if (WHOLE.has(unitCode)) return Math.ceil(qty - 1e-9);
  switch (unitCode) {
    case 'g':
    case 'ml':
      if (qty < 10) return decimals(qty, 1);
      if (qty <= 100) return Math.round(qty);
      return roundTo(qty, 5);
    case 'kg':
    case 'l':
    case 'cl':
      return decimals(qty, 2);
    case 'tsp':
    case 'tbsp':
      return Math.max(0.5, roundTo(qty, 0.5));
    case 'to_taste':
      return 0;
    default:
      return decimals(qty, 2);
  }
}

/** "1,5 kg", "2 gousses", "selon le goût". Plain space, French comma. */
export function displayQuantity(qty: number | null, unitCode: string): string {
  const known = UNITS.find((u) => u.code === unitCode);
  if (unitCode === 'to_taste') return known!.label;
  if (qty === null) return known?.label ?? unitCode;
  const rounded = roundForDisplay(qty, unitCode);
  const number = String(rounded).replace('.', ',');
  const label = known ? (rounded >= 2 ? known.plural : known.label) : unitCode;
  return label ? `${number} ${label}` : number;
}

/** Case, accents, dots and extra spaces ignored. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ALIASES: Record<string, string[]> = {
  g: ['g', 'gr', 'gramme', 'grammes'],
  kg: ['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'],
  ml: ['ml', 'millilitre', 'millilitres'],
  cl: ['cl', 'centilitre', 'centilitres'],
  l: ['l', 'litre', 'litres'],
  tsp: ['tsp', 'cac', 'c a c', 'c a cafe', 'cuillere a cafe', 'cuilleres a cafe'],
  tbsp: ['tbsp', 'cas', 'c a s', 'c a soupe', 'cuillere a soupe', 'cuilleres a soupe'],
  piece: ['', 'piece', 'pieces', 'pc', 'pcs', 'u', 'unite', 'unites'],
  clove: ['clove', 'gousse', 'gousses'],
  bunch: ['bunch', 'botte', 'bottes'],
  slice: ['slice', 'tranche', 'tranches'],
  leaf: ['leaf', 'feuille', 'feuilles'],
  pinch: ['pinch', 'pincee', 'pincees'],
  to_taste: ['to_taste', 'selon le gout', 'au gout', 'a volonte'],
};

const BY_TEXT = new Map(
  Object.entries(ALIASES).flatMap(([code, texts]) =>
    texts.map((text) => [text, code] as const),
  ),
);

/** A legacy free-text unit as a unit code; `null` when it is none of them. */
export function unitFromText(text: string): string | null {
  return BY_TEXT.get(fold(text)) ?? null;
}
