/**
 * Import depuis un lien : la requête sortante, protégée contre le SSRF. Chaque saut
 * (redirection comprise) est revérifié, l'adresse résolue doit être publique, et la
 * connexion est faite sur cette adresse (pas de seconde résolution DNS entre le
 * contrôle et l'appel).
 */

import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

import {
  isPrivateAddress,
  URL_MAX_BYTES,
  URL_MAX_REDIRECTS,
  URL_TIMEOUT_MS,
  urlProblem,
} from './domain/url-source.rules';

export class UnsafeUrlError extends Error {}

export type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

interface Hop {
  status: number;
  location?: string;
  contentType: string;
  body: string;
}

function get(url: URL, address: string): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: address,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          host: url.host,
          'user-agent': 'LabsFood-RecipeImport/1.0',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'fr-FR,fr;q=0.9',
        },
        timeout: URL_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > URL_MAX_BYTES) {
            req.destroy(new UnsafeUrlError('Page trop lourde.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location:
              typeof res.headers.location === 'string' ? res.headers.location : undefined,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new UnsafeUrlError('La page ne répond pas.')));
    req.on('error', reject);
    req.end();
  });
}

/** Le HTML d'une page publique, ou une `UnsafeUrlError` lisible. */
export async function fetchPublicPage(
  raw: string,
  resolve: Resolve = resolveAll,
  hop = get,
): Promise<string> {
  let current = raw;
  const deadline = Date.now() + URL_TIMEOUT_MS;
  for (let i = 0; i <= URL_MAX_REDIRECTS; i++) {
    const problem = urlProblem(current);
    if (problem) throw new UnsafeUrlError(problem);
    const url = new URL(current);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await resolve(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new UnsafeUrlError('Adresse interne refusée.');
    }
    if (Date.now() > deadline) throw new UnsafeUrlError('La page ne répond pas.');
    const res = await hop(url, addresses[0]);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, url).toString();
      continue;
    }
    if (res.status !== 200) throw new UnsafeUrlError(`La page répond ${res.status}.`);
    if (!/html|xml|text\/plain/i.test(res.contentType)) {
      throw new UnsafeUrlError("Ce lien n'est pas une page web.");
    }
    return res.body;
  }
  throw new UnsafeUrlError('Trop de redirections.');
}
