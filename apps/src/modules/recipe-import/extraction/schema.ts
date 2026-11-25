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
import {
  DEFAULT_RECIPE_PROFILES,
  DEFAULT_REHEAT_MODES,
} from '../../platform-settings/recipe-lists';

/** Les modes de réchauffage que le modèle peut rendre (`GET /referentials/reheat-modes`). */
export const REHEAT_MODE_CODES = DEFAULT_REHEAT_MODES.map((m) => m.code);
/** Les profils que le modèle peut proposer (`GET /referentials/recipe-profiles`). */
export const PROFILE_CODES = DEFAULT_RECIPE_PROFILES.map((p) => p.code);

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
  /** Durée de conservation au congélateur, en mois, quand le plat se congèle. */
  freezerMonths?: number | null;
  storageContainer: string | null;
  reheatingModes: string[];
  reheatingMinutes: number | null;
  reheatingTemperature: number | null;
  reheatingContainer: string | null;
  reheatingNote: string | null;
  equipment: string[];
  /** Profils de la liste (enfants, sportif…) qui vont clairement au plat. */
  profiles?: string[];
  suspectedAllergens: string[];
  estimatedFields: string[];
  warnings: string[];
}

export interface Extraction {
  recipes: ExtractedRecipe[];
  warnings: string[];
}

const str = { type: 'string' } as const;
// Anthropic limite à 16 les paramètres à type union (nullable ou anyOf). Les champs de
// texte libre valent donc "" quand la source ne dit rien ; parseExtraction les remet à null.
const optionalText = str;
const nullable = (type: string) => ({ type: [type, 'null'] });
// anyOf plutôt que `type: ['string', 'null']` + enum : Anthropic refuse un enum
// déclaré sur un type multiple (« Enum value … does not match declared type »).
const nullableEnum = (values: readonly string[]) => ({
  anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }],
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
  preparation: optionalText,
  optional: { type: 'boolean' },
  group: optionalText,
  certain: { type: 'boolean' },
});

const step = strict({
  text: str,
  type: nullableEnum(STEP_TYPE_CODES),
  durationMinutes: nullable('integer'),
});

const recipe = strict({
  name: str,
  description: optionalText,
  portions: nullable('integer'),
  portionsNote: optionalText,
  prepMinutes: nullable('integer'),
  cookMinutes: nullable('integer'),
  difficulty: nullableEnum(['easy', 'medium', 'hard']),
  category: nullableEnum(DISH_CATEGORY_CODES),
  country: nullableEnum(COUNTRY_CODES),
  ingredients: { type: 'array', items: ingredient },
  steps: { type: 'array', items: step },
  storageDays: nullable('integer'),
  freezable: nullable('boolean'),
  freezerMonths: nullable('integer'),
  storageContainer: optionalText,
  reheatingModes: {
    type: 'array',
    items: { type: 'string', enum: [...REHEAT_MODE_CODES] },
  },
  reheatingMinutes: nullable('integer'),
  reheatingTemperature: nullable('integer'),
  reheatingContainer: optionalText,
  reheatingNote: optionalText,
  equipment: { type: 'array', items: str },
  profiles: { type: 'array', items: { type: 'string', enum: [...PROFILE_CODES] } },
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

/** Les champs de texte libre rendus "" quand la source ne dit rien. */
export const OPTIONAL_TEXT_FIELDS = {
  recipe: [
    'description',
    'portionsNote',
    'storageContainer',
    'reheatingContainer',
    'reheatingNote',
  ],
  ingredient: ['preparation', 'group'],
} as const;

export const EXTRACTION_SCHEMA_NAME = 'recipe_extraction';

/** Ajouté devant une page web : toujours une source publiée par un tiers. */
export const PUBLISHED_SOURCE_NOTE =
  'Source publiée par un tiers (page web) : reformule les étapes avec tes propres mots.';

/** La consigne, en français, commune à tous les fournisseurs. */
export function extractionPrompt(): string {
  return [
    'Tu lis une fiche recette de cuisinier (PDF, capture de l’app Notes, photo de livre de cuisine ou texte collé).',
    'Rends chaque recette présente, en respectant strictement le schéma JSON. Si la source contient plusieurs recettes, liste-les toutes.',
    'Règles :',
    '- Le but : une fiche complète, que le cuisinier n’ait presque rien à saisir. Les ingrédients, leurs quantités et les étapes viennent de la source, jamais inventés. Les autres champs de la fiche (pays, catégorie, description, difficulté, temps, conservation, congélation, réchauffage, matériel) sont toujours remplis : repris de la source quand elle les donne, sinon estimés de façon réaliste d’après la recette, et le nom de chaque champ estimé va dans estimatedFields (country, category, description, difficulty, prepMinutes, cookMinutes, storageDays, freezable, freezerMonths, reheatingModes, reheatingMinutes, reheatingTemperature, reheatingNote, equipment, portions). Seuls storageContainer, reheatingContainer, portionsNote, preparation et group restent "" quand la source n’en dit rien.',
    '- country : le pays d’origine culinaire du plat (code ISO 3166 alpha-2 : FR pour un bœuf bourguignon, TH pour un pad thaï, MA pour un tajine). Pour un plat sans origine marquée, le pays de la cuisine dont il relève le plus. category : toujours une valeur de la liste.',
    '- description : si la source n’en a pas, écris en une ou deux phrases ce qu’est le plat, sobre et appétissante, sans superlatif.',
    `- Unités autorisées : ${UNIT_CODES.join(', ')}. Convertis « c. à s. » en tbsp, « c. à c. » en tsp, « une pincée » en pinch, « QS » ou « selon le goût » en to_taste. Sans unité claire, unit = null.`,
    '- rawText recopie la ligne d’ingrédient telle qu’écrite. name est le nom simple de l’ingrédient au singulier (« oignon », pas « 2 oignons émincés ») ; la préparation (« émincé ») va dans preparation.',
    '- certain = false quand la ligne est mal lisible ou ambiguë.',
    `- Types d’étape : ${STEP_TYPE_CODES.join(', ')}. Donne toujours un type à chaque étape, y compris la dernière (répartir en boîtes : mise_en_boite).`,
    '- Temps de cuisson, temps de préparation et durée de conservation au réfrigérateur : si la source ne les donne pas, estime une valeur réaliste et mets le nom du champ (cookMinutes, prepMinutes, storageDays) dans estimatedFields.',
    '- Source publiée par un tiers (page web, photo ou PDF d’un livre ou d’un magazine : numéro de page, éditeur, ISBN, mise en page imprimée, signature d’un autre auteur) : reprends la liste des ingrédients, mais reformule chaque étape avec tes propres mots, sans recopier aucune phrase, et ajoute l’avertissement « source publiée » dans warnings. Les notes personnelles du cuisinier (capture de Notes, texte collé, fiche maison) gardent leurs étapes telles qu’écrites.',
    '- freezable : true dès que la source dit que le plat se congèle (« congelable : oui », « se congèle », « se garde au congélateur »), false si elle dit le contraire ; si elle n’en parle pas, estime-le d’après le plat (une sauce à base d’œuf crue, une salade crue, une mayonnaise ne se congèlent pas ; un plat mijoté, une soupe, un curry se congèlent). freezerMonths : la durée au congélateur citée, sinon estimée (3 en général), null si le plat ne se congèle pas. storageContainer : le contenant de conservation cité (« boîte hermétique »).',
    `- Réchauffage : reheatingModes liste tous les modes cités (${REHEAT_MODE_CODES.join(', ')}) : four = oven, poêle = pan, casserole = saucepan, micro-ondes = microwave, vapeur = steam, bain-marie = bain-marie, à servir froid ou tel quel = none. reheatingMinutes et reheatingTemperature (°C) : la durée et la température citées (s’il y en a plusieurs, la plus courte durée, et null pour la température quand aucune n’est donnée ou qu’elle est « sans objet »). reheatingContainer : le contenant dans lequel on réchauffe ou sert. reheatingNote : le conseil de réchauffage en une ou deux phrases, avec les durées par mode quand elles diffèrent. Si la source ne dit rien du réchauffage, propose le ou les modes adaptés au plat, une durée, une température pour le four et une consigne courte.`,
    '- equipment : le matériel principal nécessaire (cocotte, four, mixeur…), déduit des étapes si la source ne le liste pas.',
    `- profiles : seulement les profils (${PROFILE_CODES.join(', ')}) qui vont clairement au plat ; [] dans le doute.`,
    `- suspectedAllergens : les allergènes (codes ${ALLERGEN_CODES.join(', ')}) que tu soupçonnes d’après les ingrédients ; ce n’est qu’une aide, le cuisinier confirmera.`,
    '- Écris en français. Mets dans warnings tout ce qui mérite une vérification (texte coupé, quantité illisible, portions incohérentes).',
  ].join('\n');
}
