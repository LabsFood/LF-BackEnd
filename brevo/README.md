# Brevo email templates

The transactional emails the API sends through Brevo (candidature, KYC documents, dishes).
The repo is the source of truth for their text; Brevo holds a copy that `upload.mjs` keeps in sync.

| File | What it is |
|---|---|
| `layout.html` | Shared shell: header, footer, `<!-- title -->` and `<!-- content -->` slots |
| `templates/BREVO_TPL_*.html` | One email each. The file name is the env var holding its Brevo id |
| `templates.mjs` | Loads layout + templates. No runtime data ever goes through it |
| `upload.mjs` | Creates, checks and updates the templates in Brevo |
| `*.test.mjs` | Contract, security rules and upload behaviour |

Run the tests by hand before every upload (Node built-ins only, no network, no API key):

```bash
node --test brevo/*.test.mjs
```

Upload commands need `BREVO_API_KEY` in the env file (`node --env-file=<repo-root .env> brevo/upload.mjs …`).

## Add a template

1. Create `templates/BREVO_TPL_<NAME>.html`, starting like the others:
   ```html
   <!-- subject: Texte du sujet {{ params.x }} -->
   {% comment %}
   params: x y someUrl
   One line on who sends it and anything surprising about a param.
   {% endcomment %}
   ```
   then the body, copying blocks (title, paragraph, button, quote box) from an existing template.
2. In the backend, add `BREVO_TPL_<NAME>` to `env.validation.ts`, `config.loader.ts` (`brevo.templates`),
   `.env.example`, and a mailer method that sends exactly the params listed in step 1.
3. `node --test brevo/*.test.mjs`, then a PR.
4. After merge: `upload.mjs` creates it and prints `BREVO_TPL_<NAME>=<id>`. Set that on Railway and in `.env`.

## Edit a template

1. Change the HTML file (text, subject, or the `params:` line if the mailer's params changed).
2. `node --test brevo/*.test.mjs`, then a PR.
3. After merge: `upload.mjs --check` should list it as `changed in the repo`; `upload.mjs --update` pushes it.

If `--check` says `edited in Brevo`, someone changed it in Brevo's editor. Copy that change into the
HTML file first, then `upload.mjs --update --force`. `--update` never overwrites a Brevo edit without it.

Renaming a file creates a new template: point the env var at the new id and delete the old one in Brevo.

## Rules the tests enforce

1. A template uses only the params on its `params:` line (and loop variables); no `{{ contact.* }}`.
2. No unescaped output: no `|safe`, `autoescape off` or `{% raw %}`. Brevo escapes every variable.
3. `href` / `src` are `https:`, `mailto:` or a server-built `{{ params.*Url }}`.
4. Inside an HTML tag, the only variable allowed is `{{ params.*Url }}`. Names, cities, dish titles and
   admin reasons are typed by people (some on a public form): they go in text, never in attributes.
5. `BREVO_TPL_APPLICATION_RECEIVED` and `BREVO_TPL_SIGN_IN_LINK` keep `href="{{ params.signInUrl }}"`:
   it is the candidate's only way into their account.
6. Output is built from the static files only.

## Traps

- Keep comment blocks plain text: Brevo parses them, so `{{` or `{%` inside breaks the template.
- Admin reasons sit in boxes with `white-space:pre-line`: a line break added there shows in the email.
- Subjects are plain text: use a real non-breaking space (U+00A0) before `:` and inside « », not `&nbsp;`.
- Dates are numeric (`01/10/2026`): Brevo's date filter cannot write « 1er ».
- Every upload adds an `uploaded <digest>` comment before `</body>`; leave it in Brevo, it is how
  `--check` tells a repo change from a Brevo edit.
