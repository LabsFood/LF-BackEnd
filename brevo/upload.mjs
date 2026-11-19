/**
 * Creates and updates the Brevo templates from `templates.mjs`. The env file needs
 * BREVO_API_KEY.
 *
 *   node --env-file=<repo-root .env> brevo/upload.mjs                   create missing templates, print BREVO_TPL_*=<id>
 *   node --env-file=<repo-root .env> brevo/upload.mjs --check           compare Brevo with the repo, exit 1 on any difference
 *   node --env-file=<repo-root .env> brevo/upload.mjs --update          also push repo changes to existing templates
 *   node --env-file=<repo-root .env> brevo/upload.mjs --update --force  … and overwrite edits made in Brevo
 *
 * Every upload records what it pushed in the template itself, as an
 * `uploaded <digest>` comment block (Brevo strips it when sending). A template edited
 * in Brevo since then no longer matches its digest, and is never overwritten
 * without --force.
 */
import { createHash } from 'node:crypto';

import { templates } from './templates.mjs';

const flags = new Set(process.argv.slice(2));
const [check, update, force] = ['--check', '--update', '--force'].map((f) => flags.delete(f));
if (flags.size || (check && update) || (force && !update)) {
  console.error('Usage: node brevo/upload.mjs [--check | --update [--force]]');
  process.exit(2);
}

async function brevo(path, init = {}) {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    // Runs at container start: a slow Brevo must not hold the API back.
    signal: AbortSignal.timeout(15_000),
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      accept: 'application/json',
      'content-type': 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo ${init.method ?? 'GET'} ${path}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null; // PUT answers 204 with no body
}

// Whitespace-insensitive, in case Brevo reformats the HTML it stores.
const digest = (subject, html) =>
  createHash('sha256')
    .update(`${subject}\n${html.replace(/\s+/g, ' ').trim()}`)
    .digest('hex')
    .slice(0, 16);
const STAMP = /\{% comment %\}uploaded ([0-9a-f]{16})\{% endcomment %\}/;
const stamped = (t) =>
  t.html.replace('</body>', () => `{% comment %}uploaded ${digest(t.subject, t.html)}{% endcomment %}\n</body>`);

/** How the template held by Brevo compares with the repo version. */
function compare(t, live) {
  if (!live) return 'missing';
  const html = live.htmlContent ?? ''; // no HTML reads as a Brevo edit: never overwritten silently
  const liveDigest = digest(live.subject, html.replace(STAMP, ''));
  if (liveDigest === digest(t.subject, t.html)) return 'up to date';
  return liveDigest === html.match(STAMP)?.[1] ? 'changed in the repo' : 'edited in Brevo';
}

// ponytail: first page only (1000, the API max) — page with `offset` if the account
// ever holds more templates than that.
const { templates: existing = [] } = await brevo('/smtp/templates?limit=1000');
const byName = new Map(existing.map((t) => [t.name, t]));
let failed = false;

for (const t of templates) {
  const live = byName.get(t.name);
  const state = compare(t, live);
  if (check) {
    console.log(`${t.name}: ${state}`);
    failed ||= state !== 'up to date';
    continue;
  }

  let id = live?.id;
  if (!live) {
    ({ id } = await brevo('/smtp/templates', {
      method: 'POST',
      body: JSON.stringify({
        templateName: t.name,
        subject: t.subject,
        htmlContent: stamped(t),
        sender: { email: 'contact@labsfood.fr', name: 'Lab’s Food' },
        isActive: true,
      }),
    }));
  } else if (update && (state === 'changed in the repo' || (force && state === 'edited in Brevo'))) {
    // Content only: sender and active status stay as they are in Brevo.
    await brevo(`/smtp/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ subject: t.subject, htmlContent: stamped(t) }),
    });
    console.error(`${t.name}: updated in Brevo.`);
  } else if (state !== 'up to date') {
    console.error(
      `${t.name}: ${state}, left unchanged.${update ? ' --force overwrites it.' : ' See --check and --update.'}`,
    );
    failed ||= update;
  }
  console.log(`${t.name}=${id}`);
}
process.exitCode = failed ? 1 : 0;
