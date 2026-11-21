/**
 * Import de recettes par IA (DAT §4) : le format que le modèle doit rendre, et la
 * consigne qui l'accompagne. Le schéma est strict (toutes les clés requises, aucune
 * clé en plus, `null` quand la source ne dit rien) pour être accepté tel quel par les
 * sorties structurées de Mistral comme de Claude.
 */

import { COUNTRY_CODES } from '../../dishes/domain/countries';
import { ALLERGEN_CODES, DISH_CATEGORY_CODES } from '../../dishes/domain/dishes.rules';
import { STEP_TYPE_CODES } from '../../dishes/domain/recipes.rules';
import { UNIT_CODES } from '../../dishes/domain/units.rules';

/** Une ligne d'ingrédient telle que le modèle la lit. */
export interface ExtractedIngredient {
  rawText: string;
  qty: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  optional: boolean;
  group: string | null;
  certain: boolean;
}

export interface ExtractedStep {
  text: string;
  type: string | null;
  durationMinutes: number | null;
}

export interface ExtractedRecipe {
  name: string;
  description: string | null;
  portions: number | null;
  portionsNote: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  category: string | null;
  country: string | null;
  ingredients: ExtractedIngredient[];
  steps: ExtractedStep[];
  storageDays: number | null;
  freezable: boolean | null;
  reheatingNote: string | null;
  equipment: string[];
  suspectedAllergens: string[];
  estimatedFields: string[];
  warnings: string[];
}

export interface Extraction {
  recipes: ExtractedRecipe[];
  warnings: string[];
}

const str = { type: 'string' } as const;
const nullable = (type: string) => ({ type: [type, 'null'] });
const nullableEnum = (values: readonly string[]) => ({
  type: ['string', 'null'],
  enum: [...values, null],
});
const strict = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const ingredient = strict({
  rawText: str,
  qty: nullable('number'),
  unit: nullableEnum(UNIT_CODES),
  name: str,
  preparation: nullable('string'),
  optional: { type: 'boolean' },
  group: nullable('string'),
  certain: { type: 'boolean' },
});

const step = strict({
  text: str,
  type: nullableEnum(STEP_TYPE_CODES),
  durationMinutes: nullable('integer'),
});

const recipe = strict({
  name: str,
  description: nullable('string'),
  portions: nullable('integer'),
  portionsNote: nullable('string'),
  prepMinutes: nullable('integer'),
  cookMinutes: nullable('integer'),
  difficulty: nullableEnum(['easy', 'medium', 'hard']),
  category: nullableEnum(DISH_CATEGORY_CODES),
  country: nullableEnum(COUNTRY_CODES),
  ingredients: { type: 'array', items: ingredient },
  steps: { type: 'array', items: step },
  storageDays: nullable('integer'),
  freezable: nullable('boolean'),
  reheatingNote: nullable('string'),
  equipment: { type: 'array', items: str },
  suspectedAllergens: {
    type: 'array',
    items: { type: 'string', enum: [...ALLERGEN_CODES] },
  },
  estimatedFields: { type: 'array', items: str },
  warnings: { type: 'array', items: str },
});

/** Le schéma JSON de la réponse. */
export const EXTRACTION_SCHEMA = strict({
  recipes: { type: 'array', items: recipe },
  warnings: { type: 'array', items: str },
});

export const EXTRACTION_SCHEMA_NAME = 'recipe_extraction';

/** La consigne, en français, commune à tous les fournisseurs. */
export function extractionPrompt(): string {
  return [
    'Tu lis une fiche recette de cuisinier (PDF, capture de l’app Notes, photo de livre de cuisine ou texte collé).',
    'Rends chaque recette présente, en respectant strictement le schéma JSON. Si la source contient plusieurs recettes, liste-les toutes.',
    'Règles :',
    '- Ne jamais inventer : un champ que la source ne donne pas vaut null. Si tu estimes une valeur (portions, temps, durée de conservation), mets le nom du champ dans estimatedFields.',
    `- Unités autorisées : ${UNIT_CODES.join(', ')}. Convertis « c. à s. » en tbsp, « c. à c. » en tsp, « une pincée » en pinch, « QS » ou « selon le goût » en to_taste. Sans unité claire, unit = null.`,
    '- rawText recopie la ligne d’ingrédient telle qu’écrite. name est le nom simple de l’ingrédient au singulier (« oignon », pas « 2 oignons émincés ») ; la préparation (« émincé ») va dans preparation.',
    '- certain = false quand la ligne est mal lisible ou ambiguë.',
    `- Types d’étape : ${STEP_TYPE_CODES.join(', ')}, ou null.`,
    '- Pour une photo de livre publié, reformule les étapes avec tes propres mots (ne recopie pas le texte mot pour mot) et ajoute un avertissement « source publiée ».',
    `- suspectedAllergens : les allergènes (codes ${ALLERGEN_CODES.join(', ')}) que tu soupçonnes d’après les ingrédients ; ce n’est qu’une aide, le cuisinier confirmera.`,
    '- Écris en français. Mets dans warnings tout ce qui mérite une vérification (texte coupé, quantité illisible, portions incohérentes).',
  ].join('\n');
}
