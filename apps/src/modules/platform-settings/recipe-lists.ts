import { Prisma } from '../../generated/prisma/client';

/** One entry of a list an admin edits: a stable code, the label shown. */
export interface ListItem {
  code: string;
  label: string;
}

type Db = Pick<Prisma.TransactionClient, 'platformSetting'>;

export const REHEAT_MODES_KEY = 'reheat_modes';

/** Recettes §4.6: the modes the fronts listed before the list became editable. */
export const DEFAULT_REHEAT_MODES: ListItem[] = [
  { code: 'oven', label: 'Four' },
  { code: 'pan', label: 'Poêle' },
  { code: 'saucepan', label: 'Casserole' },
  { code: 'microwave', label: 'Micro-ondes' },
  { code: 'steam', label: 'Vapeur' },
  { code: 'bain-marie', label: 'Bain-marie' },
  { code: 'none', label: 'Tel quel, sans réchauffer' },
];

const isListItem = (value: unknown): value is ListItem =>
  !!value &&
  typeof (value as ListItem).code === 'string' &&
  typeof (value as ListItem).label === 'string' &&
  (value as ListItem).code.trim() !== '' &&
  (value as ListItem).label.trim() !== '';

/** The saved list when it is one, the defaults otherwise. */
export async function listInForce(
  db: Db,
  key: string,
  defaults: ListItem[],
): Promise<ListItem[]> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  const saved: unknown[] = Array.isArray(row?.value) ? row.value : [];
  return saved.length > 0 && saved.every(isListItem)
    ? (saved as ListItem[]).map(({ code, label }) => ({ code, label }))
    : defaults;
}

export const reheatModesInForce = (db: Db) =>
  listInForce(db, REHEAT_MODES_KEY, DEFAULT_REHEAT_MODES);

export const RECIPE_PROFILES_KEY = 'recipe_profiles';

/** Recettes §4.8: the PRD's examples, until an admin changes the list. */
export const DEFAULT_RECIPE_PROFILES: ListItem[] = [
  { code: 'kids', label: 'Adapté aux enfants' },
  { code: 'post-partum', label: 'Post-partum' },
  { code: 'sport', label: 'Sportif' },
  { code: 'budget', label: 'Petit budget' },
  { code: 'high-protein', label: 'Riche en protéines' },
];

export const recipeProfilesInForce = (db: Db) =>
  listInForce(db, RECIPE_PROFILES_KEY, DEFAULT_RECIPE_PROFILES);
