/**
 * Import depuis un lien (DAT §4 ter) : protection SSRF et lecture de la page.
 * Le lien ne doit jamais faire appeler à l'API une adresse interne.
 */

import { isIP } from 'node:net';

export const URL_TIMEOUT_MS = 10_000;
export const URL_MAX_BYTES = 2 * 1024 * 1024;
export const URL_MAX_REDIRECTS = 3;
/** Le texte envoyé au modèle, au plus. */
export const URL_MAX_TEXT = 30_000;

/** Les adresses qu'une page publique n'a aucune raison d'être. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const v6 = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      v6 === '::' ||
      v6 === '::1' ||
      v6.startsWith('fc') ||
      v6.startsWith('fd') ||
      v6.startsWith('fe8') ||
      v6.startsWith('fe9') ||
      v6.startsWith('fea') ||
      v6.startsWith('feb') ||
      v6.startsWith('ff')
    );
  }
  return true;
}

/** Le motif du refus d'un lien avant toute requête, ou `null`. */
export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Lien invalide.';
  }
  if (url.protocol !== 'https:') return 'Seuls les liens https sont acceptés.';
  if (url.username || url.password) return 'Lien avec identifiants refusé.';
  if (url.port && url.port !== '443') return 'Port non standard refusé.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) return 'Adresse interne refusée.';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  ) {
    return 'Adresse interne refusée.';
  }
  return null;
}

type JsonLd = Record<string, unknown>;

const isRecipe = (node: JsonLd) => {
  const type = node['@type'];
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
};

function findRecipe(node: unknown): JsonLd | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const obj = node as JsonLd;
  if (isRecipe(obj)) return obj;
  return findRecipe(obj['@graph']);
}

/** La recette schema.org/Recipe d'une page, si elle en déclare une. */
export function schemaOrgRecipe(html: string): JsonLd | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of blocks) {
    try {
      const found = findRecipe(JSON.parse(body.trim()));
      if (found) return found;
    } catch {
      // Un bloc JSON-LD abîmé n'empêche pas de lire les autres.
    }
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Le texte lisible d'une page : sans scripts, styles ni balises. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(
            e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
          )
        : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, URL_MAX_TEXT);
}

/** Ce qu'on envoie au modèle pour une page : la recette déclarée, sinon le texte. */
export function pageForModel(html: string, url: string): string {
  const recipe = schemaOrgRecipe(html);
  if (recipe) {
    const keep = [
      'name',
      'description',
      'recipeYield',
      'prepTime',
      'cookTime',
      'totalTime',
      'recipeCategory',
      'recipeCuisine',
      'recipeIngredient',
      'recipeInstructions',
    ];
    const slim = Object.fromEntries(
      keep.filter((k) => k in recipe).map((k) => [k, recipe[k]]),
    );
    return `Recette schema.org lue sur ${url} :\n${JSON.stringify(slim).slice(0, URL_MAX_TEXT)}`;
  }
  return `Texte de la page ${url} :\n${htmlToText(html)}`;
}
