/**
 * brevo/upload.mjs against a fake Brevo API, preloaded with --import so the script
 * runs unchanged and nothing reaches the network. Run: node --test brevo/*.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { templates } from './templates.mjs';

const KEY = 'xkeysib-test-secret';
const STAMP = /\{% comment %\}uploaded [0-9a-f]{16}\{% endcomment %\}\n/;

// Lists FAKE_EXISTING, logs POST and PUT bodies to stderr, answers anything else 404.
const FAKE_BREVO = `
const existing = JSON.parse(process.env.FAKE_EXISTING);
let id = 100;
globalThis.fetch = async (url, init = {}) => {
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  if (init.headers['api-key'] !== '${KEY}') return reply(401, { message: 'Key not found' });
  const base = 'https://api.brevo.com/v3/smtp/templates';
  if (!init.method && url === base + '?limit=1000')
    return reply(200, { count: existing.length, templates: existing });
  if (init.method === 'POST' && url === base) {
    const body = JSON.parse(init.body);
    process.stderr.write('POST ' + JSON.stringify(body) + '\\n');
    if (body.templateName === process.env.FAKE_REJECT) return reply(400, { message: 'sender is invalid' });
    return reply(201, { id: id++ });
  }
  if (init.method === 'PUT' && url.startsWith(base + '/')) {
    const body = { id: Number(url.slice(base.length + 1)), ...JSON.parse(init.body) };
    process.stderr.write('PUT ' + JSON.stringify(body) + '\\n');
    return new Response(null, { status: 204 });
  }
  return reply(404, { message: 'unexpected ' + (init.method ?? 'GET') + ' ' + url });
};`;

function upload(args = [], env = {}) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(FAKE_BREVO)}`,
      fileURLToPath(new URL('./upload.mjs', import.meta.url)),
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, BREVO_API_KEY: KEY, FAKE_EXISTING: '[]', FAKE_REJECT: '', ...env },
    },
  );
  const logged = (verb) =>
    stderr
      .split('\n')
      .filter((line) => line.startsWith(`${verb} `))
      .map((line) => JSON.parse(line.slice(verb.length + 1)));
  const lines = stdout.split('\n').filter(Boolean);
  return { status, stdout, stderr, lines, posts: logged('POST'), puts: logged('PUT') };
}
const withExisting = (list) => ({ FAKE_EXISTING: JSON.stringify(list) });

// What Brevo holds right after a first upload, as its list endpoint returns it.
const uploaded = upload().posts.map((p, i) => ({
  id: 100 + i,
  name: p.templateName,
  subject: p.subject,
  htmlContent: p.htmlContent,
}));
const live = (name) => uploaded.find((t) => t.name === name);

// One template in each state compared with the repo.
const DRIFTED = [
  ...uploaded.filter(
    (t) =>
      ![
        'BREVO_TPL_CHEF_SUSPENDED',
        'BREVO_TPL_APPLICATION_APPROVED',
        'BREVO_TPL_SIGN_IN_LINK',
        'BREVO_TPL_SOURCE_CHANGED',
      ].includes(t.name),
  ),
  // BREVO_TPL_CHEF_SUSPENDED: missing.
  // Changed in the repo: Brevo still holds an earlier upload, digest intact.
  {
    ...live('BREVO_TPL_APPLICATION_APPROVED'),
    subject: live('BREVO_TPL_DOCUMENT_REJECTED').subject,
    htmlContent: live('BREVO_TPL_DOCUMENT_REJECTED').htmlContent,
  },
  // Edited in Brevo: the text no longer matches the digest it was uploaded with.
  {
    ...live('BREVO_TPL_SIGN_IN_LINK'),
    htmlContent: live('BREVO_TPL_SIGN_IN_LINK').htmlContent.replace('Me connecter', 'Se connecter'),
  },
  // Reformatted by Brevo: whitespace only, still up to date.
  {
    ...live('BREVO_TPL_SOURCE_CHANGED'),
    htmlContent: live('BREVO_TPL_SOURCE_CHANGED').htmlContent.replaceAll('\n', '\n\n  '),
  },
];

test('creates every template on an empty account and prints only env lines', () => {
  const { status, lines, posts } = upload();

  assert.equal(status, 0);
  assert.deepEqual(lines, templates.map((t, i) => `${t.name}=${100 + i}`));
  assert.deepEqual(
    posts.map(({ htmlContent, ...rest }) => ({ ...rest, htmlContent: htmlContent.replace(STAMP, '') })),
    templates.map((t) => ({
      templateName: t.name,
      subject: t.subject,
      htmlContent: t.html,
      sender: { email: 'contact@labsfood.fr', name: 'Lab’s Food' },
      isActive: true,
    })),
  );
  for (const p of posts) assert.match(p.htmlContent, STAMP, `${p.templateName}: no upload digest`);
});

test('leaves a template that already exists untouched and prints its id', () => {
  const existing = [{ ...live('BREVO_TPL_SIGN_IN_LINK'), id: 7 }];
  const { status, lines, posts, puts } = upload([], withExisting(existing));

  assert.equal(status, 0);
  assert.equal(lines.length, templates.length);
  assert.ok(lines.includes('BREVO_TPL_SIGN_IN_LINK=7'));
  assert.equal(posts.length, templates.length - 1);
  assert.ok(!posts.some((p) => p.templateName === 'BREVO_TPL_SIGN_IN_LINK'));
  assert.equal(puts.length, 0);
});

test('stops at the first Brevo error, keeps the ids already printed, never prints the key', () => {
  const { status, lines, stdout, stderr } = upload([], { FAKE_REJECT: templates[2].name });

  assert.equal(status, 1);
  assert.deepEqual(lines, [`${templates[0].name}=100`, `${templates[1].name}=101`]);
  assert.match(stderr, /400 .*sender is invalid/);
  assert.ok(!(stdout + stderr).includes(KEY));
});

test('a wrong API key fails before anything is created', () => {
  const { status, lines, posts, stderr } = upload([], { BREVO_API_KEY: 'wrong' });

  assert.equal(status, 1);
  assert.deepEqual(lines, []);
  assert.equal(posts.length, 0);
  assert.match(stderr, /401 .*Key not found/);
});

test('--check: everything up to date right after an upload', () => {
  const { status, lines, posts, puts } = upload(['--check'], withExisting(uploaded));

  assert.equal(status, 0);
  assert.deepEqual(lines, templates.map((t) => `${t.name}: up to date`));
  assert.equal(posts.length + puts.length, 0);
});

test('--check: reports each kind of difference, writes nothing, exits 1', () => {
  const { status, lines, posts, puts } = upload(['--check'], withExisting(DRIFTED));

  assert.equal(status, 1);
  assert.ok(lines.includes('BREVO_TPL_CHEF_SUSPENDED: missing'));
  assert.ok(lines.includes('BREVO_TPL_APPLICATION_APPROVED: changed in the repo'));
  assert.ok(lines.includes('BREVO_TPL_SIGN_IN_LINK: edited in Brevo'));
  assert.ok(lines.includes('BREVO_TPL_SOURCE_CHANGED: up to date'));
  assert.equal(posts.length + puts.length, 0);
});

test('--update: pushes repo changes, creates missing ones, refuses to overwrite a Brevo edit', () => {
  const { status, lines, posts, puts, stderr } = upload(['--update'], withExisting(DRIFTED));

  assert.equal(status, 1);
  assert.equal(lines.length, templates.length);
  assert.deepEqual(posts.map((p) => p.templateName), ['BREVO_TPL_CHEF_SUSPENDED']);
  const approved = live('BREVO_TPL_APPLICATION_APPROVED');
  assert.deepEqual(puts, [{ id: approved.id, subject: approved.subject, htmlContent: approved.htmlContent }]);
  assert.match(stderr, /BREVO_TPL_SIGN_IN_LINK: edited in Brevo, left unchanged\. --force overwrites it\./);
});

test('--update --force: overwrites the Brevo edit too, and --check agrees afterwards', () => {
  const { status, posts, puts } = upload(['--update', '--force'], withExisting(DRIFTED));

  assert.equal(status, 0);
  assert.deepEqual(puts.map((p) => p.id).sort(), [
    live('BREVO_TPL_APPLICATION_APPROVED').id,
    live('BREVO_TPL_SIGN_IN_LINK').id,
  ].sort());

  const after = [
    ...DRIFTED.map((t) => ({ ...t, ...puts.find((p) => p.id === t.id) })),
    ...posts.map((p) => ({ id: 999, name: p.templateName, subject: p.subject, htmlContent: p.htmlContent })),
  ];
  assert.equal(upload(['--check'], withExisting(after)).status, 0);
});

test('rejects unknown or conflicting flags before calling Brevo', () => {
  for (const args of [['--force'], ['--check', '--update'], ['--dry-run']]) {
    const { status, stderr, posts, puts } = upload(args);
    assert.equal(status, 2, args.join(' '));
    assert.match(stderr, /Usage: node brevo\/upload\.mjs/);
    assert.equal(posts.length + puts.length, 0);
  }
});
