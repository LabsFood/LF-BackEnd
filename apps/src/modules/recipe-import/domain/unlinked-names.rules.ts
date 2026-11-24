/**
 * Import de recettes : l'apprentissage du référentiel. Les noms d'ingrédients que les
 * imports n'ont pas su relier remontent à l'admin, regroupés (« pâte de crevette » et
 * « pâte de crevettes » ne font qu'un), sans ceux que la liste commune connaît déjà ni
 * ceux que l'admin a écartés. Pour chacun, l'entrée existante la plus proche est
 * proposée comme rattachement (« piment rouge thaï » → autre nom de « Piment ») ;
 * l'admin décide toujours, les allergènes d'un nouvel ingrédient se saisissent à la main.
 */

import { matchKey } from '../../ingredients/domain/ingredient.rules';

export const IGNORED_NAMES_KEY = 'recipe_import_ignored_names';
export const MAX_IGNORED_NAMES = 2000;

export interface SeenName {
  name: string;
  count: number;
  chefs: number;
}

export interface CatalogEntry {
  id: string;
  name: string;
  aliases: string[];
}

export interface UnlinkedName extends SeenName {
  suggestion: CatalogEntry | null;
}

/** Les clés déjà écartées, telles que stockées dans `platform_settings`. */
export function ignoredFrom(value: unknown): string[] {
  const list = (value as { keys?: unknown } | null)?.keys;
  return Array.isArray(list)
    ? list.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
}

/** Ajoute un nom aux écartés (par sa clé), sans doublon, dans la limite. */
export function withIgnored(keys: string[], name: string): string[] {
  const key = matchKey(name);
  if (!key || keys.includes(key)) return keys;
  return [...keys, key].slice(-MAX_IGNORED_NAMES);
}

/**
 * L'entrée dont le nom ou un autre nom tient en mots entiers dans le nom lu, la plus
 * longue d'abord (« piment rouge thaï » → « piment rouge » avant « piment »).
 */
export function closestEntry(name: string, entries: CatalogEntry[]): CatalogEntry | null {
  const words = ` ${matchKey(name)} `;
  let best: { entry: CatalogEntry; length: number } | null = null;
  for (const entry of entries) {
    for (const text of [entry.name, ...entry.aliases]) {
      const key = matchKey(text);
      if (key.length < 3 || !words.includes(` ${key} `)) continue;
      if (!best || key.length > best.length) best = { entry, length: key.length };
    }
  }
  return best?.entry ?? null;
}

/**
 * Les propositions pour l'admin : regroupées par clé (le nom le plus vu l'emporte),
 * sans les noms désormais reliés ni les écartés, les plus fréquentes d'abord.
 */
export function unlinkedProposals(
  seen: SeenName[],
  entries: CatalogEntry[],
  ignoredKeys: string[],
): UnlinkedName[] {
  const known = new Set<string>();
  for (const entry of entries)
    for (const text of [entry.name, ...entry.aliases]) known.add(matchKey(text));
  const ignored = new Set(ignoredKeys);

  const groups = new Map<string, { best: SeenName; count: number; chefs: number }>();
  for (const s of seen) {
    const key = matchKey(s.name);
    if (!key || known.has(key) || ignored.has(key)) continue;
    const group = groups.get(key);
    if (!group) groups.set(key, { best: s, count: s.count, chefs: s.chefs });
    else {
      group.count += s.count;
      // Les batch cookers de deux graphies peuvent se recouper : on garde le maximum.
      group.chefs = Math.max(group.chefs, s.chefs);
      if (s.count > group.best.count) group.best = s;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      name: g.best.name,
      count: g.count,
      chefs: g.chefs,
      suggestion: closestEntry(g.best.name, entries),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
}
