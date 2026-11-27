# URSSAF immediate advance, manual mode: UI testbook

A click-by-click walk through the immediate advance (« avance immédiate ») while
`URSSAF_GATEWAY=manual`: the client site (batchcooking-web) and the admin console
(admin-dashboard), with the French labels exactly as the screens show them.

In manual mode nothing is sent to URSSAF by the API. The client's request joins the admin
queue; an admin enters it by hand on the intermediary's online space, then
records the request's reference and URSSAF's answer in the console. The commission is not
debited on its own: the admin collects it from the batch cooker's transactions.

Source of truth: PR #92 (`368cc19`, _avance immédiate, manual route_) and
`97aaef9` (the dossier needs an address). Routes and rules are in
[`stripe-payments-contract.md`](stripe-payments-contract.md) and the Swagger
(`/docs`, tag _payments_). If a label below no longer matches a screen, the screen wins:
fix this file.

---

## 0. Before you start

### 0.1 API configuration

| Variable | Value for this test |
|----------|---------------------|
| `URSSAF_GATEWAY` | `manual` (allowed beside live Stripe keys, unlike `simulated`) |
| `KYC_ENCRYPTION_KEY` | 32 bytes, base64 (`openssl rand -base64 32`). Required in manual mode: the API refuses to start without it (or with a key that is not 32 bytes) |

- The migrations `20261013120000_urssaf_links` and `20261116120000_urssaf_client_dossiers`
  must be applied on the target database.
- The private KYC bucket must be reachable: the dossier is sealed there (AES-256-GCM).
  Postgres keeps only the path and the IBAN's last four digits.
- Changing the key after dossiers were saved makes them unreadable
  (`KYC_STORAGE_UNAVAILABLE` in the console). Do not rotate it during the test.

### 0.2 Accounts

| Who | Where | Needs |
|-----|-------|-------|
| **Admin** | admin console, `/login` | a Clerk account whose `/me` role is `admin` |
| **Batch cooker** (chef) | site, `/espace-chef` | verified, online, Stripe Connect done |
| **Client** | site, `/espace-client` | a client account, not the same person as the chef (`SAME_PERSON`) |

Use test identities only. The dossier holds a real-looking IBAN; take the test one below.

### 0.3 Test data

| Field | Valid | Invalid (for the negative checks) |
|-------|-------|-----------------------------------|
| IBAN | `FR76 3000 6000 0112 3456 7890 189` | `FR76 3000 6000 0112 3456 7890 188` (checksum) |
| BIC | `AGRIFRPP` | `AGRI` |
| Mobile | `06 12 34 56 78` | `01 23 45 67 89` (not a mobile) |
| Birth place | France, commune « Paris » (75056) | — |
| Postal code (France) | `75011` | `7501` |

---

## 1. Chef: make the advance possible (site, `/espace-chef/remuneration`)

The advance is offered only for a chef who has **all three**: URSSAF habilitation `active`
(set by an admin, step 2), a **NOVA code**, and an **active SEPA mandate**
(`advanceAccepted` in `chef-cesu-info.ts`). Missing any one, the « Avance immédiate »
option is simply absent from the client's payment screen.

1. Log in as the chef. Open the remuneration page (`/espace-chef/remuneration`).
2. Under the declaration route, choose **« Déclaration à mon nom (NOVA) »**.
3. Fill **« Numéro de déclaration NOVA »**, for example `SAP123456789`. Click **« Enregistrer »**.
   - Expect the toast **« Déclaration enregistrée »**.
   - Note: a chef on **« Par une coopérative »** has no NOVA code, so the advance is not
     offered for them.
4. In the mandate block, click **« Signer le mandat »**, sign on the Stripe page, come back.
   - Expect the toast **« Mandat signé »** (« Il est rangé dans vos documents. »).
   - Before signing, the page says: « Tant que le mandat n’est pas signé, vos clients ne
     peuvent pas vous régler en CESU ni par l’avance immédiate. »

## 2. Admin: record the chef's URSSAF habilitation (console, Batch cookers)

1. Console → **Batch cookers** → open the chef → tab **« Profil »**.
2. In the block **« CESU et avance immédiate »**, set **« Avance immédiate URSSAF »** to
   **« Affiliation active »** (the other values: « Pas de démarche », « Demande en cours »).
3. Click **« Enregistrer »**.
   - Expect: « Statuts enregistrés. Son espace les affiche désormais. »
   - The block only shows for a verified chef.

## 3. Client: fill the URSSAF dossier (site)

The dossier comes first in manual mode: Lab's Food enrols the client on the URSSAF space with it.

### 3.1 Where to find it

Three entry points, all landing on the same form:

- **« Bien démarrer »** checklist on the client home: step **« Votre dossier URSSAF »**,
  button **« Remplir »** (the step only exists while the advance is offered).
- **Mon compte** (`/espace-client/compte`) → tab **« Avance immédiate »**.
- The payment screen, link **« Remplir mon dossier »** (step 5.2).

Page: `/espace-client/compte/avance-immediate`, title **« Mon dossier pour l’avance immédiate »**.

### 3.2 Fill it

The form is pre-filled from the account (name split into first/last, mobile, email,
address). Check every field:

1. **« État civil »**: « Civilité » (Madame / Monsieur), « Nom de naissance »,
   « Nom d’usage (facultatif) », « Prénoms, dans l’ordre de l’état civil »,
   « Date de naissance ».
2. **« Lieu de naissance »**: pick **« En France »**, type `Paris` in
   « Commune de naissance », choose it in the list. It shows « Paris 75056 » with
   **« Changer »**.
3. **« Coordonnées »**: « Mobile », « Email », « Adresse », « Complément (facultatif) »,
   « Code postal », « Ville ».
4. **« Compte prélevé par l’URSSAF »**: « IBAN », « BIC », « Titulaire du compte ».
5. Click **« Enregistrer mon dossier »** (disabled while the IBAN is empty).

Expect:

- The button turns into **« Dossier enregistré »**, and the badge
  **« Dossier enregistré le JJ/MM/AAAA »** appears under the title.
- The IBAN field empties. Its help now reads « IBAN enregistré se terminant par 0189.
  Saisissez-le à nouveau pour enregistrer une modification. » The API never returns the IBAN.
- « Bien démarrer » ticks « Votre dossier URSSAF ».

### 3.3 Negative checks on the form

Each refusal shows under its own field, plus a summary line
(« Une réponse est à corriger, indiquée sous les champs. » / « N réponses sont à corriger… »).

| Do | Expect under the field |
|----|------------------------|
| IBAN with a bad checksum | « Cet IBAN n’est pas valide : vérifiez-le sur votre RIB. » |
| BIC `AGRI` | « Un BIC de 8 ou 11 caractères, sur votre RIB. » |
| Mobile `01 23 45 67 89` | « Un mobile français : 06, 07 ou +33. » |
| Date in the future | « Une date passée, au format JJ/MM/AAAA. » |
| A digit in « Nom de naissance » | « Lettres, espaces, tirets et apostrophes seulement. » |
| « En France » with no commune chosen | « À renseigner. » |
| « À l’étranger » with no country | « Choisissez un pays dans la liste. » |
| Postal code `7501` (address in France) | « Cinq chiffres. » |

### 3.4 Delete (optional, at the end)

**« Supprimer mon dossier »** → « Supprimer votre dossier ? L’avance immédiate ne pourra
plus être utilisée sans un nouveau dossier. » → **« Oui, supprimer »**. The form comes back
empty and pre-filled from the account.

## 4. Client: ask for the enrolment (« rattachement »)

The enrolment is per client **and** per chef. It is asked from the payment screen of a
prestation with that chef.

1. You need a prestation with this chef that is **due**: status `pending` (the
   « Régler maintenant » banner of a new booking), `completed`, or `confirmed` and already
   ended. Before it ends, the page shows « La prestation n’a pas eu lieu ».
2. Open the booking (`/espace-client/commandes/{id}`) → **« Régler maintenant »** (or
   **« Voir le règlement »**). Page title **« Régler la prestation »**.
   - If the CGV boxes show (« Avant de payer, acceptez les conditions de cette
     prestation »), tick them and click « Valider, puis payer avec obligation de paiement ».
3. Under **« Comment souhaitez-vous régler ? »**, the option reads
   **« Avance immédiate (crédit d’impôt 50 %) »**, tagline
   « Rien à régler ici », amount **« Rien à payer »**. It is greyed out, with the reason:

   | State | Reason shown | Action link |
   |-------|--------------|-------------|
   | No dossier (step 3 skipped) | « L’avance immédiate demande d’abord votre dossier URSSAF (identité, coordonnées bancaires), à remplir une fois. » | **« Remplir mon dossier »** |
   | Dossier filled, never asked | « L’avance immédiate demande un rattachement à ce batch cooker, à faire une fois. » | **« Demander le rattachement »** |
   | Asked, waiting for the admin | « Votre demande de rattachement est en cours d’instruction. » | — |
   | Refused | « L’URSSAF a refusé le rattachement à ce batch cooker. » | — |

4. With the dossier filled, click **« Demander le rattachement »** (it shows
   « Demande en cours… »). The reason changes to « …en cours d’instruction. »

## 5. Admin: enrol the client on the URSSAF space

Console → **Transactions** → tab **« Avance immédiate »**.

The header explains the manual mode. The console does not know the gateway mode up
front: if the first « Rattacher » or « Marquer payé » shows the warning « La passerelle
URSSAF n'est ni en mode manuel ni simulé sur ce serveur… » and greys the buttons, the API
is not in manual mode: stop and fix `URSSAF_GATEWAY`.

1. Section **« Rattachements en attente »**: the client's row shows the client name,
   « avec {chef} · demandé le JJ/MM/AAAA », the email, and the badge **« En attente »**.
2. Click **« Dossier »**. The drawer **« Dossier URSSAF »** opens: « À recopier sur
   l'espace URSSAF de Lab’s Food pour rattacher ce client (prestations de {chef}). Cette lecture est tracée. »
   - Blocks: **« Identité »**, **« Contact »**, **« Compte prélevé par l'URSSAF »** (full
     IBAN, BIC, Titulaire), **« Batch cooker »** (« Numéro SAP / NOVA »).
   - Each value has a copy button. The opening is audited (`urssaf.dossier_revealed`).
3. On the **URSSAF space**, enter the client's enrolment with these values and the chef's NOVA.
4. Back in the console, record the answer:
   - Accepted: **« Rattacher »**. Toast **« Rattachement actif »** (« Le client peut régler
     avec l'avance immédiate. »). The row leaves the list.
   - Refused: **« Refuser »** → dialog **« Refuser le rattachement ? »**, enter the reason
     (5 characters at least) → **« Refuser le rattachement »**. Toast « Rattachement refusé ».

Audit: `urssaf.link_recorded`.

## 6. Client: pay with the advance

1. Reload the payment screen. The option **« Avance immédiate (crédit d’impôt 50 %) »**
   is now selectable.
2. Select it. In the **« Récapitulatif »**: « Prix de la prestation », « Crédit d’impôt
   déduit immédiatement », and **« À régler aujourd’hui sur le site »** at 0 €. Below:
   « L’URSSAF prélèvera ensuite {50 %} sur le compte de votre rattachement et réglera
   {prénom} directement. »
3. Click **« Confirmer la prestation »**. The confirmation reads « Vous confirmez que la
   prestation du {date} a bien eu lieu. Lab’s Food s’occupe de l’inscription et de la gestion
   administrative de la demande : rien n’est encaissé ici. »
4. Click **« Oui, je confirme »**.
   - The page becomes **« Règlement en cours »** (« Votre demande est enregistrée pour
     {référence}… »). It refreshes on its own.
   - On the booking page: « Règlement en cours : votre demande est enregistrée, rien
     d’autre à faire. »
   - Nothing was charged on the site. A second click or a second tab answers
     « Votre demande est déjà transmise à l’URSSAF. » (`URSSAF_REQUEST_PENDING`).

## 7. Admin: enter the request on the URSSAF space and record the answer

Console → **Transactions** → **« Avance immédiate »** → section **« Demandes de paiement »**.

1. The new row shows the full amount and « dont {50 %} prélevés au client », then
   « {client} → {chef} · {référence} », then **« NOVA {code} · JJ/MM/AAAA »**.
   Badge **« À saisir manuellement »**, button **« Noter la saisie »**.
2. On the **URSSAF space**, enter the payment request (amount, client, chef's NOVA). Note the
   reference it gives.
3. Click **« Noter la saisie »**. Dialog **« Noter la saisie »** (it repeats the
   amount and the NOVA). Paste the reference into « Référence de la demande »
   (3 to 100 characters) → **« Noter la saisie »**.
   - Toast **« Saisie notée »** (« La demande attend la réponse de l'URSSAF. »).
   - The row now shows « · Réf. {référence} », badge **« En attente de l'URSSAF »**,
     buttons **« Refuser »** and **« Marquer payé »**.
   - Audit: `urssaf.payment_transmitted`.
4. When the URSSAF space shows URSSAF's answer:
   - **Paid**: **« Marquer payé »**. Toast **« Paiement validé »**: « La prestation est
     réglée. La commission attend : prélevez-la depuis la fiche du batch cooker. »
     Badge **« Payé »**.
   - **Refused**: **« Refuser »** → dialog **« Refuser la demande de paiement ? »**, reason
     (5 characters at least) → **« Refuser la demande »**. Toast « Paiement refusé ».
     Badge **« Refusé »**, the reason shows on the row.
   - Audit: `urssaf.payment_recorded`.

### 7.1 What the client sees afterwards

- Paid: the payment screen shows **« Réglée. »** (« {montant} réglés sur {référence}. »);
  the booking page says « Réglée. ».
- Refused: the payment screen is back, with « Le dernier règlement n’a pas abouti. Rien
  n’a été débité : vous pouvez recommencer, avec le moyen de votre choix. » Card and CESU
  remain offered; the advance can be asked again.

## 8. Admin: collect the commission

In manual mode, « Marquer payé » leaves the commission pending
(`urssaf.commission_awaiting_admin` in the API logs).

1. Console → **Batch cookers** → the chef → tab **« Ses transactions »**.
2. Stat cards: **« À prélever maintenant »** (count and amount), « Prélèvements en cours »,
   « Encaissées ».
3. The paid advance shows « Avance immédiate », the client, the booking reference, the
   reference, and « Commission {montant} · À prélever ». A commission on a request
   still waiting says « Attend le paiement de la prestation » and cannot be ticked.
4. Tick it (« Cochez les commissions à prélever. » → « 1 commission choisie · {montant} »),
   click **« Prélever la sélection »**.
5. Dialog **« Prélever {montant} ? »** (« La facture ne se retire plus… ») →
   **« Émettre et prélever »**.
   - Expect the toast **« Facture {numéro} émise »** (« Prélèvement de {montant} envoyé. »),
     or « Facture {numéro} émise, prélèvement refusé » if Stripe declines it (the facture B
     stays due and is retried from Transactions → « Commissions »).
   - The commission moves to « Facturée » / « Prélèvement en cours », then « Encaissée ».
   - Audit: `commission.collect_manual`.

## 9. Negative and edge cases

| # | Setup | Do | Expect |
|---|-------|----|--------|
| 9.1 | Chef without NOVA, or mandate not signed, or habilitation not « Affiliation active » | Open the client's payment screen | No « Avance immédiate » option at all |
| 9.2 | Request already noted | Note the saisie again (stale tab) | « Cette demande est déjà notée comme saisie. Rechargez la liste. » (`URSSAF_ALREADY_TRANSMITTED`) |
| 9.3 | Request already paid or refused | Answer it again (stale tab) | « Cette demande a déjà reçu sa réponse. Rechargez la liste. » (`URSSAF_REQUEST_SETTLED`) |
| 9.4 | Request not yet noted | Call `POST /admin/urssaf-payments/{id}/outcome` with `paid` and no reference (the UI hides « Marquer payé » until the saisie) | 422 `URSSAF_REFERENCE_REQUIRED` |
| 9.5 | Commission on a request still pending, or already invoiced | `POST /admin/chefs/{id}/commissions/collect` with it | 409 `COMMISSION_NOT_COLLECTABLE` |
| 9.6 | Chef's mandate revoked after the payment | « Prélever la sélection » | « Ce batch cooker n'a pas de mandat SEPA actif : rien ne peut être prélevé. » |
| 9.7 | Client with a pending enrolment deletes the dossier | Reload the payment screen | Reason back to « …demande d’abord votre dossier URSSAF… » |
| 9.8 | Client deletes the dossier after asking the enrolment | Admin clicks « Dossier » | « Dossier illisible » / « Ce client n'a pas encore rempli son dossier URSSAF. » |
| 9.9 | Client paid in CESU, waiting for the chef | Open the payment screen | Advance greyed with « Vos titres CESU attendent la confirmation du batch cooker… » |
| 9.10 | Gateway set back to `disabled` | Open the payment screen, then click « Rattacher » in the console | Option gone on the site; in the console the action fails, the « ni en mode manuel ni simulé » warning appears and the buttons grey out |

## 10. URSSAF takes a payment back (status 120)

1. On a paid request, click **« Reprise URSSAF »**.
2. Dialog **« L’URSSAF a repris cette prestation (statut 120) ? »**, reason (« Motif donné
   par l'URSSAF… ») → **« Enregistrer la reprise »**.
3. Expect « Reprise enregistrée »: either « La commission, pas encore facturée, est
   retirée. » or « Avoir {numéro} de {montant} émis au batch cooker. ». The row shows
   « Reprise URSSAF (statut 120) le JJ/MM/AAAA ». The prestation is due again on the site.
   Audit: `commission.credited`.

## 11. Check the audit trail

```sql
select created_at, action, subject_type, subject_id, outcome
from audit_log
where action like 'urssaf.%' or action like 'commission.%'
order by created_at desc
limit 20;
```

After a full happy path you should see, newest first: `commission.collect_manual`,
`urssaf.payment_recorded`, `urssaf.payment_transmitted`, `urssaf.link_recorded`,
`urssaf.dossier_revealed`. Dossier saves and deletes are API log events
(`urssaf.dossier_saved`, `urssaf.dossier_deleted`), not audit rows, and never carry the
dossier's content.

## 12. Known gaps (as of `97aaef9`)

- After a refused enrolment the payment screen offers no « Demander le rattachement »
  link; the API accepts a new `POST /me/urssaf-links` (it reopens the enrolment), but the
  client has no button for it.
- « Rattachements en attente » lists only pending enrolments; there is no console view of
  active or refused ones yet (`GET /admin/urssaf-links?status=…` exists).
