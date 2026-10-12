/**
 * The contract and safety rules every Brevo template must pass. Run by hand before
 * an upload: node --test brevo/*.test.mjs
 *
 * Each rule also runs on a deliberately broken copy of a real template, so a rule
 * that stops matching anything fails instead of passing silently.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as loaded from './templates.mjs';

const { templates } = loaded;
const SIGN_IN_EMAILS = new Set(['BREVO_TPL_APPLICATION_RECEIVED', 'BREVO_TPL_SIGN_IN_LINK']);
const COMMENT = /\{% comment %\}([\s\S]*?)\{% endcomment %\}/g;

/** The `params:` line of the template's comment block. */
const declared = (t) => t.html.match(/\{% comment %\}\nparams: (.+)\n/)?.[1].split(' ') ?? [];
/** What Brevo evaluates: subject and HTML, comment blocks removed. */
const code = (t) => (t.subject + t.html).replace(COMMENT, '');

const RULES = {
  'uses only the params it declares': (t) => {
    const allowed = new Set(declared(t));
    const src = code(t);
    const loopVars = new Set([...src.matchAll(/\{%\s*for (\w+) in /g)].map((m) => m[1]));
    return [...src.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g)].flatMap(([, value, block]) => {
      const inner = (value ?? block).replace(/"[^"]*"/g, '""'); // filter arguments out of the way
      const bad = [...inner.matchAll(/\b(\w+)\.(\w+)/g)]
        .filter(([, root, prop]) => root !== 'params' || !allowed.has(prop))
        .map(([ref]) => ref);
      const head = value?.split('|')[0].trim();
      if (head && !head.includes('.') && !loopVars.has(head)) bad.push(head);
      return bad;
    });
  },

  'never outputs unescaped HTML': (t) =>
    code(t).match(/\|\s*safe|autoescape\s+off|\{%\s*(raw|filter\s+safe)/g) ?? [],

  'links are https, mailto or a server-built *Url param': (t) =>
    [...code(t).matchAll(/\s(?:href|src|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)]
      .map(([, value]) => value.replace(/^["']|["']$/g, ''))
      .filter((url) => !/^(https:\/\/|mailto:)|^\{\{ params\.\w+Url \}\}$/.test(url)),

  'user text never lands in an attribute': (t) =>
    [...code(t).matchAll(/<[a-z][^>]*>/gi)].flatMap(([tag]) =>
      [...tag.matchAll(/\{\{([\s\S]*?)\}\}|\{%/g)]
        .filter(([, value]) => !/^\s*params\.\w+Url\s*$/.test(value ?? ''))
        .map(() => tag.slice(0, 80)),
    ),

  'sign-in emails carry the sign-in link': (t) =>
    SIGN_IN_EMAILS.has(t.name) && !t.html.includes('href="{{ params.signInUrl }}"')
      ? ['no href="{{ params.signInUrl }}"']
      : [],

  'built from static files only': (t) =>
    [t.subject, t.html].filter((s) => typeof s !== 'string' || /\$\{|\[object /.test(s)),
};

const base =
  templates.find((t) => t.name === 'BREVO_TPL_SIGN_IN_LINK') ??
  assert.fail('BREVO_TPL_SIGN_IN_LINK is missing (the broken fixtures are built from it)');
const broken = (html) => ({ ...base, html });
const FIXTURES = {
  'uses only the params it declares': broken(`${base.html}<p>{{ params.password }}{{ contact.EMAIL }}</p>`),
  'never outputs unescaped HTML': broken(`${base.html}<p>{{ params.firstName|safe }}</p>`),
  'links are https, mailto or a server-built *Url param': broken(`${base.html}<a href="javascript:alert(1)">x</a>`),
  'user text never lands in an attribute': broken(
    `${base.html}<a href="{{ params.signInUrl }}" title="{{ params.firstName }}">x</a>`,
  ),
  'sign-in emails carry the sign-in link': broken(base.html.replaceAll('params.signInUrl', 'params.dossierUrl')),
  'built from static files only': broken(`${base.html}\${params.firstName}`),
};

for (const [rule, check] of Object.entries(RULES)) {
  test(rule, () => {
    for (const t of templates) assert.deepEqual(check(t), [], t.name);
    assert.ok(FIXTURES[rule], 'every rule needs a broken fixture');
    assert.notDeepEqual(check(FIXTURES[rule]), [], 'the rule no longer catches its broken fixture');
  });
}

test('every template loads with a subject and a params block', () => {
  assert.deepEqual(Object.keys(loaded), ['templates']);
  // The emails carrying the only way into a new account cannot go missing.
  for (const name of SIGN_IN_EMAILS) assert.ok(templates.some((t) => t.name === name), `${name} is missing`);
  for (const t of templates) {
    assert.match(t.name, /^BREVO_TPL_[A-Z_]+$/);
    assert.ok(t.subject.trim(), `${t.name}: empty subject`);
    assert.ok(declared(t).length, `${t.name}: no params line in its comment block`);
    // Brevo parses comment blocks, so they must stay plain text.
    for (const [, inner] of t.html.matchAll(COMMENT)) {
      assert.doesNotMatch(inner, /\{\{|\{%/, `${t.name}: template tag inside a comment block`);
    }
  }
});
