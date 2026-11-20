# Réservation directe : moyen validé à la réservation, acceptation du chef, débit après la session

Décisions du 2026-11-19 : le chef accepte chaque demande (CGV 5.2) ; rattachement URSSAF « en cours » accepté, la carte servant de secours ; tout le parcours pour le 21/11.

Choix de méthode : **règle de domaine, test d'abord** (`bookings/domain/booking-request.rules.ts` + spec). Il s'agit d'une machine d'états liée à de l'argent, d'une règle décidée, et elle sert aux modules bookings et payments.

## Cible (CGV V1)

1. Le client choisit son moyen (`card` | `urssaf` | `cesu`) et enregistre sa carte, quel que soit le moyen (7.2). Rien n'est débité.
2. La demande part au chef une fois la carte enregistrée. Le chef accepte ou refuse sous 48 h, délai ramené à T si le début est plus proche. À l'acceptation : `confirmed` et `concludedAt`, ce qui fait partir la rétractation (15.1). En cas de refus ou d'expiration : `cancelled`, rien n'est débité (5.2).
3. À la fin de la session, le débit est automatique (7.3) :
   - carte : débit hors session de la carte enregistrée ;
   - URSSAF : la demande de paiement part toute seule. Si le rattachement n'est pas actif, la carte est débitée ;
   - CESU : le client déclare ses titres (flux existant) ; on le relance.
   - Réservation faite moins de 48 h avant T avec la carte : débit dès l'acceptation.
4. Si le débit échoue : le client est notifié et a 48 h pour régulariser depuis l'écran de paiement existant (7.5).

## Lots

**L1. Règles (pures, spec d'abord)** : `acceptBy(submittedAt, startsAt)`, `chargeAt(method, acceptedAt, startsAt, endsAt)`, `methodProblem(method, chefAccepts, urssafLink, dossier)` qui renvoie `URSSAF_LINK_REFUSED | URSSAF_LINK_NONE | URSSAF_DOSSIER_MISSING | METHOD_NOT_OFFERED | null` (le statut PENDING passe), `settlementPlan(...)` qui renvoie `card | urssaf | card_fallback | remind_cesu | skip`. On ajoute le déplacement `pending>confirmed` pour le chef dans `MOVES`.

**L2. Schéma (migration à appliquer par toi)** : sur `Booking`, `paymentMethod`, `stripeCustomerId`, `stripePaymentMethodId`, `cardBrand`, `cardLast4`, `cardExpMonth`, `cardExpYear`, `cardSavedAt`, `submittedAt`, `acceptBy`, `acceptedAt`, `refusedAt`, `chargeClaimedAt`, `chargeReminderSentAt`. Le `holdReminderSentAt` actuel est conservé pour le rappel au chef.

**L3. Création et carte** :
- `POST /me/bookings` reçoit `paymentMethod`, contrôlé par `methodProblem`.
- `POST /me/bookings/{id}/card` ouvre un Checkout `setup` (même modèle que `GroceriesStripe.createSetupSession`, même client Stripe).
- `POST /me/bookings/{id}/card/confirm` et le webhook `setup_intent.succeeded` enregistrent la carte, puis renseignent `submittedAt`/`acceptBy` et notifient le chef.
- La course réutilise la carte de la réservation (plus de second formulaire).
- Une demande sans carte au bout d'1 h est annulée.

**L4. Acceptation** :
- `POST /chef/bookings/{id}/accept` : `confirmed`, `concludedAt`, e-mail contrat (existant), plus le débit immédiat si `chargeAt` vaut maintenant.
- `POST /chef/bookings/{id}/refuse`, avec un motif optionnel.
- `expireUnpaid` est remplacé par `expireRequests` : rappel au chef à mi-délai, annulation à `acceptBy`.
- `settlePayment` ne confirme plus une réservation directe (seul le chef le fait). Les réservations issues d'un devis ne changent pas.

**L5. Débit en fin de session (cron horaire)** :
- Réservations `confirmed…completed` avec `endsAt ≤ now`, un reste dû, aucun paiement en cours et pas de litige.
- Le débit est réservé par `chargeClaimedAt` (plusieurs réplicas).
- Carte : PaymentIntent hors session, `on_behalf_of`, frais d'application égal à la commission (reprise de `createIntentForBooking`), clé d'idempotence prise sur l'id de la ligne Payment.
- URSSAF : `settleWithUrssaf` en mode système.
- Le webhook existant fait le règlement.

**L6. Lectures et textes** :
- Vue réservation : moyen choisi, carte (marque et 4 derniers chiffres), `acceptBy`, état de la demande.
- `payment-options.savedCards` est rempli et le moyen choisi présélectionné.
- Mise à jour du Swagger, de `docs/` et des textes « 72 h » / « le paiement confirme ».
- Erreurs typées `{code, message}`, logs structurés sans données personnelles.

## E-mails / Brevo (nouveaux templates → Railway develop, puis production)

Demande reçue (chef), demande acceptée (client, en plus du contrat existant), demande refusée ou expirée (client), débit refusé (client), relance CESU (client). Dans l'appli, des notifications en parallèle.

## Hors périmètre / à décider

- Le front (batchcooking-web : écran Réserver, choix du moyen, carte, « Mes sessions » ; espace chef : accepter/refuser) est **en lecture seule tant que tu ne le nommes pas**. Sans lui, le nouvel `POST /me/bookings` casse l'écran actuel.
- Réservations issues d'un devis : déjà confirmées et payées après. Le débit automatique ne s'y applique que si un moyen et une carte y sont enregistrés (pas encore le cas).
- CESU non déclaré 48 h après la fin : débit de la carte ou litige ?
