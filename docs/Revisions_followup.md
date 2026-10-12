# Revisions follow-up

## Version scheme: `vX.Y.Z`

| Segment | Meaning                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| **X**   | Major / epic releases (breaking changes, large initiatives, coordinated platform shifts) |
| **Y**   | Feature releases (new capabilities, backward-compatible additions)                       |
| **Z**   | Minor fixes and patches (bugfixes, small corrections, security patches)                  |

Examples:

- `v1.0.0` first stable epic;
- `v1.1.0` adds features on that line;
- `v1.1.3` three patch rounds after `v1.1.0`.

## Release register

| Version | Title & brief description                                                                 | Release date | Released by | Pre-release approval date |
| ------- | ----------------------------------------------------------------------------------------- | ------------ | ----------- | ------------------------- |
| v1.0.0  | Initial production API — auth, bookings, health/readiness                                 | 2026-04-15   | JDK         | -                         |
| v1.1.0  | F710 candidate — Page "Notre Concept" CMS content — **withdrawn**, CMS removed 2026-09-23 |              | JDK         | -                         |
| v2.0.0  | SignIn and SignUp - Authenfication via clerk                                              | 2026-08-15   | JDK         | -                         |
| v2.1.0  | Paiement CB Stripe — Connect destination charges, commission plateforme, fondations SAP/SEPA, attestations fiscales | | JDK | - |
| v1.x.0  | ISSUE_TYPE — ISSUE_DESC                                                                   |              |             |                           |

Replace rows with your real releases; keep **approval date** on or before **release date** for audit trail.
