/**
 * Budget IA (DAT 6 bis) : les étiquettes de chaque appel. Listes fermées, tenues
 * dans le code : un nouveau poste ou une nouvelle fonctionnalité passe par une revue
 * de code, pour que les rapports restent comparables dans le temps. Un appel sans
 * étiquette valide est refusé avant tout envoi au fournisseur.
 */

export const AI_POSTES = {
  recettes: {
    label: 'Recettes',
    features: {
      import_recette: 'Import de recette',
      verification_allergenes: 'Vérification des allergènes',
      fiche_ingredient: 'Fiches d’ingrédients',
    },
  },
  vitrine: {
    label: 'Vitrine du cuisinier',
    features: { textes_vitrine: 'Textes de présentation' },
  },
  assistant: {
    label: 'Assistant',
    features: { faq: 'Questions fréquentes', resume: 'Résumés' },
  },
  mcp: {
    label: 'Assistant MCP du cuisinier',
    features: { outil_mcp: 'Outil MCP' },
  },
  devis: {
    label: 'Devis',
    features: { brouillon_devis: 'Brouillon de devis' },
  },
} as const;

export type AiPoste = keyof typeof AI_POSTES;

/** Tags libres mais bornés : `cle:valeur`, minuscules. */
const TAG = /^[a-z0-9_]{1,24}:[a-z0-9_.-]{1,40}$/;
export const MAX_TAGS = 8;

export interface AiLabels {
  poste: string;
  feature: string;
  tags?: string[];
}

/** Le motif du refus, ou `null` quand les étiquettes sont valides. */
export function labelsProblem(labels: AiLabels): string | null {
  const poste = (AI_POSTES as Record<string, { features: Record<string, string> }>)[
    labels.poste
  ];
  if (!poste) return `Poste inconnu : « ${labels.poste} ».`;
  if (!(labels.feature in poste.features)) {
    return `Fonctionnalité « ${labels.feature} » inconnue pour le poste « ${labels.poste} ».`;
  }
  const tags = labels.tags ?? [];
  if (tags.length > MAX_TAGS) return `${MAX_TAGS} tags au plus.`;
  const bad = tags.find((tag) => !TAG.test(tag));
  return bad ? `Tag invalide : « ${bad} » (attendu cle:valeur).` : null;
}

export const isPoste = (value: string): value is AiPoste => value in AI_POSTES;
