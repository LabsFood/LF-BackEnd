/**
 * Fiches d'ingrédients remplies par l'IA : ce que le modèle rend pour un nom
 * d'ingrédient (rayon, allergènes, régimes, saisons, « de base »), la consigne qui
 * l'accompagne, et la lecture prudente de sa réponse. Sert à l'import de recettes
 * (les ingrédients inconnus deviennent des fiches complètes) et au rattrapage des
 * fiches sans rayon ou sans allergènes. Une fiche ainsi remplie reste « non revue »
 * (`reviewedAt` nul) : l'admin la relit depuis la liste.
 */

import { ALLERGEN_CODES, COMPUTED_DIET_CODES } from '../../dishes/domain/dishes.rules';
import type { ListItem } from '../../platform-settings/recipe-lists';
import { NAME_MAX, withImpliedDiets } from './ingredient.rules';

/** Noms envoyés au modèle en un appel : assez pour une recette, borné pour la sortie. */
export const ENRICH_BATCH = 40;

export interface EnrichedIngredient {
  /** Le nom tel qu'il a été demandé (clé de rapprochement). */
  asked: string;
  /** Le nom propre à donner à la fiche : singulier, majuscule initiale. */
  name: string;
  /** Faux pour ce qui n'est pas un ingrédient (« échalote et ail », « garniture »). */
  isIngredient: boolean;
  aisle: string;
  allergens: string[];
  allergensNone: boolean;
  diets: string[];
  seasonMonths: number[];
  isBasic: boolean;
}

const strict = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Le schéma de la réponse, avec les rayons de la liste en vigueur. */
export function enrichmentSchema(aisles: ListItem[]) {
  const item = strict({
    asked: { type: 'string' },
    name: { type: 'string' },
    isIngredient: { type: 'boolean' },
    aisle: { type: 'string', enum: aisles.map((a) => a.code) },
    allergens: { type: 'array', items: { type: 'string', enum: [...ALLERGEN_CODES] } },
    diets: { type: 'array', items: { type: 'string', enum: [...COMPUTED_DIET_CODES] } },
    seasonMonths: { type: 'array', items: { type: 'integer' } },
    isBasic: { type: 'boolean' },
  });
  return strict({ ingredients: { type: 'array', items: item } });
}

export const ENRICHMENT_SCHEMA_NAME = 'ingredient_sheets';

/** La consigne, en français, commune à tous les fournisseurs. */
export function enrichmentPrompt(aisles: ListItem[]): string {
  return [
    'Tu remplis la fiche d’ingrédients d’une plateforme française de batch cooking. Pour chaque nom reçu, rends une fiche, dans le même ordre, en respectant strictement le schéma JSON.',
    '- asked : le nom reçu, recopié tel quel.',
    '- name : le nom usuel en français, au singulier, avec une majuscule initiale (« Pâte de tamarin », « Oignon rouge »). Garde la précision qui change l’achat (rouge, frais, en poudre), retire les quantités et les préparations (émincé, haché).',
    '- isIngredient : false si ce n’est pas un seul ingrédient qu’on achète (« échalote et ail », « garniture », « sauce », « eau de cuisson »). Les autres champs restent alors remplis au mieux.',
    `- aisle : le rayon de supermarché où on le trouve, parmi : ${aisles.map((a) => `${a.code} (${a.label})`).join(' ; ')}.`,
    `- allergens : les allergènes réglementaires (règlement INCO 1169/2011) que l’ingrédient contient ou contient très souvent, parmi ${ALLERGEN_CODES.join(', ')}. Exemples : beurre = milk ; farine de blé = gluten ; sauce soja = soy, gluten ; nuoc-mâm = fish ; pâte de curry thaï = crustaceans (crevette) ; moutarde = mustard ; vin = sulphites. [] seulement si l’ingrédient n’en contient aucun.`,
    `- diets : les régimes que l’ingrédient respecte, parmi ${COMPUTED_DIET_CODES.join(', ')} (une tomate : vegan, vegetarian, no-pork, pescetarian, gluten-free, lactose-free ; un saumon : no-pork, pescetarian, gluten-free, lactose-free ; un lardon : gluten-free, lactose-free).`,
    '- seasonMonths : les mois (1 à 12) de pleine saison en France pour un produit frais de saison (fruits, légumes, certains poissons) ; [] pour un produit disponible toute l’année (épicerie, viande, crèmerie, surgelé).',
    '- isBasic : true pour un basique de placard que le cuisinier a toujours (sel, poivre, huile, vinaigre, sucre, farine, eau).',
  ].join('\n');
}

const MONTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

/** Lit une réponse brute : JSON, éventuellement entouré d'un bloc ```json. */
export function parseEnrichment(text: string): { ingredients: unknown[] } {
  const value = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, ''),
  ) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { ingredients?: unknown }).ingredients)
  ) {
    throw new Error('Réponse sans tableau « ingredients ».');
  }
  return value as { ingredients: unknown[] };
}

const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase('fr') + s.slice(1) : s);

/**
 * Les fiches du modèle, rapprochées des noms demandés et nettoyées : rayon de la
 * liste en vigueur, codes connus seulement, régimes impliqués ajoutés, mois valides.
 * Un nom sans fiche lisible est laissé de côté (il reste à relier à la main).
 */
export function toEnriched(
  asked: string[],
  raw: unknown[],
  aisleCodes: string[],
): EnrichedIngredient[] {
  const aisles = new Set(aisleCodes);
  const allergenCodes = new Set<string>(ALLERGEN_CODES);
  const dietCodes = new Set<string>(COMPUTED_DIET_CODES);
  const byAsked = new Map<string, Record<string, unknown>>();
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.asked === 'string' ? rec.asked.trim().toLowerCase() : '';
    // Le modèle recopie mal un nom : l'ordre fait foi en second recours.
    byAsked.set(key || `#${i}`, rec);
    if (!byAsked.has(`#${i}`)) byAsked.set(`#${i}`, rec);
  });
  const out: EnrichedIngredient[] = [];
  asked.forEach((name, i) => {
    const rec = byAsked.get(name.trim().toLowerCase()) ?? byAsked.get(`#${i}`);
    if (!rec) return;
    const aisle = typeof rec.aisle === 'string' ? rec.aisle : '';
    if (!aisles.has(aisle)) return;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const allergens = [
      ...new Set(strings(rec.allergens).filter((c) => allergenCodes.has(c))),
    ];
    const cleanName =
      typeof rec.name === 'string' && rec.name.trim()
        ? rec.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
        : capitalize(name.trim()).slice(0, NAME_MAX);
    out.push({
      asked: name,
      name: capitalize(cleanName),
      isIngredient: rec.isIngredient !== false,
      aisle,
      allergens,
      allergensNone: allergens.length === 0,
      diets: withImpliedDiets(strings(rec.diets).filter((c) => dietCodes.has(c))),
      seasonMonths: Array.isArray(rec.seasonMonths)
        ? [
            ...new Set(
              rec.seasonMonths.filter(
                (m): m is number => typeof m === 'number' && MONTHS.has(m),
              ),
            ),
          ]
            .sort((a, b) => a - b)
            // Les 12 mois : pas de saison, c'est « toute l'année ».
            .filter((_, __, all) => all.length < 12)
        : [],
      isBasic: rec.isBasic === true,
    });
  });
  return out;
}

/** Ce qu'une fiche incomplète gagne à l'IA : seulement ses champs vides. */
export function missingFieldsPatch(
  entry: {
    aisle: string | null;
    allergens: string[];
    allergensNone: boolean;
    diets: string[];
  },
  sheet: EnrichedIngredient,
): {
  aisle?: string;
  allergens?: string[];
  allergensNone?: boolean;
  diets?: string[];
} {
  const patch: ReturnType<typeof missingFieldsPatch> = {};
  if (!entry.aisle) patch.aisle = sheet.aisle;
  if (entry.allergens.length === 0 && !entry.allergensNone) {
    if (sheet.allergensNone) patch.allergensNone = true;
    else patch.allergens = sheet.allergens;
  }
  // Les régimes vides ne rendent pas la fiche incomplète, mais privent le plat de
  // ses régimes calculés : on les remplit aussi quand ils manquent.
  if (entry.diets.length === 0 && sheet.diets.length > 0) patch.diets = sheet.diets;
  return patch;
}
