# Brevo email templates — HTML sources, safety tests and an editing workflow

> Scope: the `brevo/` folder of this repo (branch `claude/brevo-email-templates-f10c02`).
> The mailers that send these templates live on `feat/chef-dishes-menus` (FLOW-01, FLOW-02).
> Constraint for every phase: Node built-ins only (`node:fs`, `node:test`, global `fetch`) — no npm dependency.

## Problem Statement

The 11 transactional templates behind `BREVO_TPL_*` are about to be created in the live Brevo account, and
nothing in the repo protects them. A template can drift from what its mailer sends, a variable can end up
unescaped or inside a link, and nobody knows how a template is added or changed once Brevo holds a copy.
The cost is silent: a broken `APPLICATION_RECEIVED` loses the candidate's only sign-in link, and an escaping
mistake puts attacker-typed text (the public candidature form) into an admin's inbox as markup.

## Evidence

- The only checks that exist are throwaway scripts outside the repo (params contract, mocked Brevo API,
  preview renderer). The repo's Jest suite covers `apps/{src,test}/**/*.ts` only (`apps/package.json`
  `lint-staged`, `jest` config), so `brevo/*.mjs` is untested.
- Editing trap, observed in the current `upload.mjs`: templates are skipped by name, so editing
  `templates.mjs` and re-running the upload changes nothing in Brevo — and nothing says so.
- Variable audit of the current templates (2026-09-25): no `|safe` / `autoescape off` / `{% raw %}`; only
  `*Url` params inside `href`; candidate-controlled `name` appears in the admin email subject and body.
- HTML lives inside JS template literals and helper functions, so the copy cannot be opened, previewed or
  reviewed as HTML. Native text import is not available: `import x from './t.html' with { type: 'text' }`
  fails with `ERR_UNKNOWN_FILE_EXTENSION` on Node 26, and `.nvmrc` pins Node 20.
- Cross-check against the live Brevo account (2026-09-24/25) found the sender, `PUBLIC_SITE_URL`, sign-in
  link and admin link problems listed under *Dependencies* — evidence that unreviewed email wiring breaks.

## Proposed Solution

Move each template's HTML into its own `.html` file (named after its env var) plus one shared `layout.html`,
loaded by a ~15-line `templates.mjs` with `readFileSync`. Each file declares its subject and its allowed
params in header comments. A `node:test` suite enforces the params contract and six security rules, and
tests `upload.mjs` against a mocked `fetch`. The repo becomes the source of truth for copy: `upload.mjs`
gains a read-only `--check` (drift report) and `--update` (push repo copy to Brevo, refusing to overwrite a
Brevo-side edit without `--force`). A short `brevo/README.md` explains how to add and how to edit a template.

Chosen over a template engine (EJS/Handlebars/Pug): Brevo's Pongo2 already renders `{{ params.x }}` at send
time, so a Node engine would only assemble static HTML at build time — a second template language with a
second escaping model. Handlebars also collides with Brevo's `{{ }}`.

## Key Hypothesis

We believe plain HTML sources guarded by `node:test` safety rules, plus a check/update upload workflow, will
keep the 11 emails correct and safe as they change, for the developers maintaining FLOW-01/FLOW-02 emails.
We'll know we're right when a param rename, a forbidden filter or a user variable in an attribute fails
`node --test brevo/*.test.mjs` offline, and a 12th template is added by following the README alone.

## What We're NOT Building

- A template engine or partials syntax — reinvents what Brevo does at send time.
- Rendering emails in Node at send time (`htmlContent` instead of `templateId`) — reverses the PRD decision
  that copy lives in Brevo and needs no backend deploy.
- A `--pull` / two-way sync — conflict handling for a team of one editor; copy a Brevo edit back by hand.
- Backend fixes found by the cross-check (sender default, `PUBLIC_SITE_URL`, Clerk link, admin URL, DTO
  validation of candidate names) — they live on `feat/chef-dishes-menus`; tracked under *Dependencies*.
- Real sends or Brevo test sends from tests — tests stay offline.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Safety rules enforced | 6/6 rules each have a test that fails on a seeded violation | `node --test brevo/*.test.mjs` with a deliberately broken fixture per rule |
| Refactor is behavior-preserving | Generated HTML identical to today's output for all 11 | Snapshot of current `templates` compared before/after phase 1 |
| Offline and fast | No network, no API key, runs in < 2 s | `node --test brevo/*.test.mjs` with networking off |
| Drift check has no false positives | 0 templates reported as drifted right after an upload | `upload.mjs --check` run immediately after the first upload |
| Docs are sufficient | A new template added using only `brevo/README.md` | Walkthrough 2026-09-25 by the author (12th template: tests green, 12 env lines); an independent walkthrough is still TBD |

## Open Questions

- [x] Where do the tests run? **By hand** (decided 2026-09-25): `node --test brevo/*.test.mjs` before an upload.
      Nothing enforces it; optional guard: `upload.mjs` runs the same checks and refuses to push on failure.
- [ ] Does Brevo store API-created `htmlContent` byte-for-byte? Brevo docs are silent (create/update only
      document the field). `--check` compares with whitespace normalized; confirm by reading one template
      back (read-only) right after the first upload.
- [x] Can click tracking be disabled? **No documented way** (2026-09-25): Brevo redirects every link to
      count clicks. Transactional *anonymous email tracking* exists (Settings > Automations > Transactional
      emails > Tracking) and unlinks clicks from the recipient. Decision: enable it; accept the redirect —
      Brevo already receives `signInUrl` as a param, and the token is single-use with a 7-day TTL.
- [x] Who edits the email text (subjects, sentences, button labels)? **A developer, through a PR**
      (decided 2026-09-25). Edits made directly in Brevo are emergencies: `--check` flags them and they are
      copied back into the repo.
- [x] Params contract: **hand-written list per file now** (catches template-side mistakes), plus one test
      comparing it to the mailers once `feat/chef-dishes-menus` is merged (decided 2026-09-25).

---

## Users & Context

**Primary User**
- **Who**: backend developer maintaining the FLOW-01/FLOW-02 emails and running the upload (today: the repo owner).
- **Current behavior**: edits JS template literals in `brevo/templates.mjs`, verifies by ad-hoc scripts, uploads once.
- **Trigger**: a new email (e.g. booking or payment flows in `docs/SPEC-BACKEND.md` §4.5), a wording change, or a mailer param change.
- **Success state**: change the HTML file, `node --test brevo/*.test.mjs` is green, `upload.mjs --check` then `--update`, done.

**Job to Be Done**
When I add or change a transactional email, I want the repo to tell me if it breaks the mailer contract or
leaks unescaped user input, so I can push it to Brevo without testing every client by hand.

**Non-Users**
Email recipients (candidates, chefs, admins) — they benefit indirectly. Marketing editing only inside Brevo's
UI — supported as an emergency path, not the main flow.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | `layout.html` + one `templates/<BREVO_TPL_NAME>.html` per template, loaded by `templates.mjs` | Separates HTML from JS; file name = env var, no mapping table |
| Must | Header per file: `<!-- subject: … -->` (stripped on load) and `{% comment %}params: …{% endcomment %}` (kept, visible to Brevo editors, stripped by Brevo at render) | Subject and contract live next to the copy |
| Must | `node:test` security rules: (1) params ⊆ declared list; (2) no `|safe`, `autoescape off`, `{% raw %}`; (3) `href` only from `*Url` params, `https:` or `mailto:`; (4) user-controlled vars never inside attributes; (5) `APPLICATION_RECEIVED` and `SIGN_IN_LINK` contain `signInUrl`; (6) the build takes no runtime data | Encodes what was only checked by hand |
| Must | `upload.mjs` tests with mocked `fetch`: create, skip existing, env-line output, error exit | The script's only logic |
| Must | `brevo/README.md`: add a template, edit a template, run the tests, security rules in one screen | Stated user request |
| Should | `upload.mjs --check` (read-only drift report, exit 1 on drift) and `--update` (PUT changed templates, refuse Brevo-edited ones without `--force`) | Makes the repo the source of truth (option B) |
| Could | Run `node --test brevo/*.test.mjs` from `.husky/pre-commit` when `brevo/` changes | Depends on open question |
| Won't | Template engine, partials, `--pull`, Node-side rendering | See *What We're NOT Building* |

### MVP Scope

Phases 1, 2 and 4: HTML split, the test suite, and the README describing the manual edit path (edit the file,
then update the existing template in Brevo by hand). Phase 3 (`--check` / `--update`) replaces that manual
step.

### User Flow

Add: create `templates/BREVO_TPL_X.html` with its two header lines → add the env var to the mailer config
(other branch) → `node --test brevo/*.test.mjs` → `upload.mjs` prints `BREVO_TPL_X=<id>` → set it on Railway.
Edit: change the HTML file → `node --test brevo/*.test.mjs` → `upload.mjs --check` → `upload.mjs --update`.

---

## Technical Approach

**Feasibility**: HIGH — two existing files (`brevo/templates.mjs` 304 lines, `brevo/upload.mjs` 52 lines), no
dependency, Brevo endpoints already used (`GET /v3/smtp/templates`, `POST /v3/smtp/templates`) plus
`GET` and `PUT /v3/smtp/templates/{templateId}` for phase 3.

**Architecture Notes**
- Loader: `readFileSync(new URL('./templates/', import.meta.url))` works on Node 20 (`.nvmrc`) and 26; native
  `.html` import does not.
- `upload.mjs` keeps its public behavior; tests stub `globalThis.fetch` (`node --test` + `--import` preload or
  `t.mock.method(globalThis, 'fetch', …)`), so the script's top-level code needs to run inside the test
  process — move the loop into an exported `main()` with a `import.meta.url` entry guard, or spawn it with
  `node:child_process` and a preload (decide in the plan).
- Variables are classified by who controls them (public form / chef / admin / server / credential); the
  classification is the input of rule (4).

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Brevo normalizes stored HTML → `--check` reports false drift | M | Verify after first upload; compare normalized whitespace; document the result |
| Refactor changes rendered HTML | L | Byte snapshot of current output before phase 1, compared after |
| Security rules implemented as regexes miss a context (e.g. `style=`) | M | One seeded-violation fixture per rule; rule (4) matches any attribute, not only `href` |
| Repeated inline styles across 11 files diverge | M | Accepted cost of plain HTML; README says where the shared styles are |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | HTML sources | `layout.html` + 11 template files + loader; output identical to today | complete | - | - | - |
| 2 | Safety & upload tests | `node:test` suite: contract, 6 security rules, upload with mocked fetch | complete | with 3 | 1 | - |
| 3 | Edit workflow | `upload.mjs --check` / `--update` / `--force`, with tests | complete | with 2 | 1 | - |
| 4 | Docs | `brevo/README.md`: add, edit, test, security rules | complete | - | 2, 3 | - |

### Phase Details

**Phase 1: HTML sources**
- **Goal**: HTML out of JS without changing a byte of what Brevo receives.
- **Scope**: `brevo/layout.html`, `brevo/templates/*.html` (11), `brevo/templates.mjs` loader.
- **Success signal**: snapshot of the 11 `{ name, subject, html }` equals the pre-refactor snapshot.

**Phase 2: Safety & upload tests**
- **Goal**: the checks done by hand become `node --test brevo/*.test.mjs`.
- **Scope**: `brevo/templates.test.mjs`, `brevo/upload.test.mjs`, one failing fixture per rule.
- **Success signal**: all green offline; each rule fails on its fixture.

**Phase 3: Edit workflow**
- **Goal**: repo is the source of truth; pushing copy needs no backend deploy.
- **Scope**: `--check`, `--update`, `--force` in `upload.mjs`; tests with mocked `GET`/`PUT`.
- **Success signal**: `--check` exits 0 right after upload and 1 after an edit on either side; `--update` never overwrites a Brevo-side edit without `--force`.

**Phase 4: Docs**
- **Goal**: add or edit a template without asking anyone.
- **Scope**: `brevo/README.md`, one screen.
- **Success signal**: a 12th template added from the README alone.

### Parallelism Notes

Phases 2 and 3 touch different files (tests vs `upload.mjs` flags) and both only need phase 1's loader.
Phase 4 documents the final commands, so it waits for both.

---

## Dependencies (outside this PRD, on `feat/chef-dishes-menus`)

Found by the cross-check against the live Brevo account; they block production sends regardless of this work:
- Sender default `noreply@labsfood.com` — domain not owned, not a Brevo sender; must be `contact@labsfood.fr`.
- `PUBLIC_SITE_URL` default `https://labsfood.fr` is the corporate site; email links 404. Batch-cooking app is `https://batchcooking.labsfood.fr`.
- `signInUrl` = Clerk `token.url` lands on Clerk's Account Portal, not the app.
- Admin link `/batchcookers/<applicationId>` points at the wrong host (console is `admin.labsfood.fr`).
- Candidate-controlled `name`/`firstName`/`city` need character and length limits in the candidature DTO.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Template engine | None | EJS, Handlebars, Pug | Brevo renders at send time; a Node engine is a second language; Handlebars collides with `{{ }}`; adds a dependency |
| HTML loading | `readFileSync` + `import.meta.url` | Native `.html` import | Not supported on Node 20/26 (`ERR_UNKNOWN_FILE_EXTENSION`) |
| Source of truth for copy | Repo, pushed by `upload.mjs --update` | Brevo (today), two-way sync | Reviewed, tested, versioned; pushing to Brevo needs no backend deploy |
| Test runner | `node:test`, run as `node --test brevo/*.test.mjs` | Jest (already in `apps/`) | No config, no dependency, `.mjs` outside `apps/`; a directory argument is not accepted by current Node, the shell glob works on Node 20 and 26 |
| Upload tests | Spawn `upload.mjs` with a fake `fetch` preloaded via `--import data:` | Refactor into an exported `main()` | Script stays unchanged; no network possible |
| When tests run | By hand, before an upload | CI, pre-commit hook | User decision 2026-09-25 |
| Who edits email text | Developer via PR | Editing directly in Brevo | User decision 2026-09-25; keeps copy reviewed and tested |
| Params contract | Hand-written per file, mailer cross-check after merge | Cross-check only; generated list | User decision 2026-09-25; mailers are on another branch |
| Click tracking | Enable transactional anonymous tracking; keep redirect | Disable tracking | Disabling is not documented by Brevo |
| Contract location | `{% comment %}params: …{% endcomment %}` in each file | Separate JSON manifest | Next to the copy, visible to Brevo editors, stripped at render |
| Knowing who changed a template | `{% comment %}uploaded <digest>{% endcomment %}` written before `</body>` on every upload; digest = sha256 of subject + whitespace-collapsed HTML | Lock file in the repo; Brevo template `tag` | Lives in each Brevo account (staging and prod each keep their own), no file to commit, stripped by Brevo at send; `tag` would split send statistics per version |
| What `--update` writes | `subject` and `htmlContent` only | Also `sender`, `isActive` | A template deactivated in Brevo stays deactivated |
| Exit codes | 0 ok, 1 difference found (`--check`) or edit refused (`--update`) or Brevo error, 2 bad flags | Always 0 | Usable in scripts |
| PRD location | `.claude/prds/` | `.claude/PRPs/prds/` | Repo convention (two existing PRDs) |

---

## Research Summary

**Market Context**
Postmark ships a CLI (`postmark-cli`) with `templates pull` / `templates push` over a local folder of HTML
files — the repo-as-source model of option B. Brevo has no official template CLI. (From prior knowledge, not
re-verified for this PRD.)

**Technical Context**
- `brevo/templates.mjs`: `layout()` + helpers (`h1`, `p`, `note`, `quote`, `list`, `button`, `rawLink`,
  `date`, `dateTime`) + 11 definitions; export `templates = definitions.map((t) => ({ ...t, html: layout(t) }))`.
- `brevo/upload.mjs`: `GET /smtp/templates?limit=1000`, skip by name, `POST` with sender
  `contact@labsfood.fr`, prints `NAME=id`; exits 1 on any Brevo error.
- Brevo template language is Pongo2: variables auto-escaped by default; filters in use:
  `time_parse`, `time_parse_rfc3339`, `time_in_location`, `date`, `slice`.
- Live account: free plan (300 sends/day), single verified sender `contact@labsfood.fr`, no `BREVO_TPL_*`
  template yet.

---

*Generated: 2026-09-25*
*Status: IMPLEMENTED — phases 1-4 complete on branch `claude/brevo-email-templates-f10c02`, not committed. Still open: Brevo HTML normalization (check after the first upload), mailer cross-check test after merge.*
