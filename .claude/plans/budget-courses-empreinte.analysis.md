# Étude — Budget Courses : empreinte bancaire, avance du batch cooker, commission en deux blocs

Étude du 11/11/2026, mise à jour le même jour avec le modèle décidé, puis avec les décisions 4 à 8 (§7).

**Ce qui est décidé :**
- Stripe Issuing est écarté (trop compliqué).
- On retient l'**option B** : une empreinte bancaire sur la carte du client, le batch cooker avance les courses.
- La **commission se calcule en deux blocs** (voir §1), **à 15 % chacun pour l'instant**, pour tous les paliers.
- Le Budget Courses ne se dépasse jamais : **100 € au plus par défaut**. Un forfait courses d'**au moins 15 €** est recommandé au chef.

Rien n'est codé. Les actions sont reportées dans le lot 6 du plan « Module Recettes » (artifact, version 4).

**Sources :**
- **Stripe** : les règles citées (durée d'une empreinte, prélèvement partiel, délais de versement, versement instantané, qui paie les frais) ont été vérifiées dans la documentation ce jour. Les **tarifs** sont les tarifs publics standard de Stripe France : à vérifier dans le Dashboard (Paramètres > Tarifs).
- **Textes** : les CGV V1 définitives, `apps/src/assets/legal/cgv-1.0.pdf`.
- **URSSAF** : la documentation de l'API Tiers de prestation, v1.30.18.

**L'exemple suivi tout au long de l'étude :**
- offre 2 à 120 €, plus 3 portions supplémentaires à 15 €, soit **165 €** de prestation ;
- forfait courses : **20 €** ;
- Budget Courses : **100 €**, le plafond par défaut ;
- courses réelles : **69,34 €** ;
- le client paie la prestation par **avance immédiate**.

---

## 0. Le bilan en bref

| | Verdict |
|---|---|
| Le modèle | **Deux blocs, au même taux pour l'instant.** Le bloc **prestation** (formule et suppléments) et le **forfait courses** paient chacun 15 % de commission. Les courses elles-mêmes n'en paient aucune. Le forfait est payé avec la prestation (avance immédiate, CESU ou carte). Les courses sont payées uniquement par carte, au montant exact, grâce à l'empreinte. |
| Faisabilité | **Oui, avec l'existant.** Le paiement de la prestation passe déjà par Stripe Connect au nom du chef (`on_behalf_of`, `payments.service.ts:86`). La facture B et son prélèvement SEPA existent. **Le calcul de la commission ne change pas** : il prend déjà 15 % du forfait avec la prestation. |
| Client | Il paie **161,84 €** : 92,50 € par l'URSSAF, plus 69,34 € par carte. Le forfait profite de l'avance immédiate. Ses 100 € restent bloqués environ 4 jours. |
| Batch cooker | **151,70 € nets** pour la prestation. Il **avance 69,34 € pendant 5 à 9 jours**, ou 1 à 2 jours avec le versement instantané (payant). Au-delà du Budget, l'écart est pour lui. |
| Lab's Food | **27,75 € HT** de commission, soit environ 25,84 € une fois les frais payés. Le bloc courses couvre ses propres frais (+1,44 € dans l'exemple). Avec le plafond de 100 €, c'est toujours le cas sur une carte standard dès un forfait de 15 €. |
| Juridique | La base est solide : le mandat de débours, et le chef qui achète à la place de Lab's Food (art. 1994 du Code civil). Les CGV définitives prévoient déjà la carte, l'empreinte, le prélèvement et la contestation. Il reste à corriger 8.2 et 6.2, à aligner le 10.4 sur le plafond strict, et à écrire le taux dans les conditions des chefs (préavis de 15 jours). |
| Code | Pas de commission par bloc à coder tant que les deux taux sont égaux. Le travail est celui du lot 6 : carte enregistrée, plafond, empreinte, tickets, prélèvement, relevés, avoir de commission en cas de reprise URSSAF. |

---

## 1. Les deux blocs

| Bloc | Contenu | Comment le client le paie | Commission (payée par le chef) |
|---|---|---|---|
| **Prestation** | Formule + suppléments : 120 € + 3 × 15 € = **165 €** | Avance immédiate, CESU ou carte | 15 % HT, soit **24,75 €** |
| **Courses** | **Forfait courses** du chef : **20 €**. Il fait partie de la prestation (art. 4.1) et ouvre droit au crédit d'impôt. | Avec la prestation : avance immédiate, CESU ou carte | 15 % HT, soit **3,00 €** |
| | **Débours** : les courses réelles, **69,34 €** | **Carte uniquement**, par l'empreinte (CGV 7.1, 7.3, 10.10) | **Aucune** (CGV 10.3) |

**Commission totale** : 27,75 € HT + 5,55 € de TVA (20 %) = **33,30 € TTC**, prise au chef :
- **prestation payée par l'URSSAF ou en CESU** : facture B, prélevée par SEPA (`commission-debits.service.ts`), soit tout de suite, soit dans le lot mensuel ;
- **prestation payée par carte** : frais d'application, retenus sur le paiement de la prestation.

Le bloc courses n'existe que si le client choisit l'option Courses. Sans elle, il n'y a ni forfait, ni empreinte.

**Pourquoi garder deux blocs avec un seul taux.** Le taux du forfait peut un jour s'écarter de celui de la prestation, qui pourrait varier selon le palier du chef. Tant que les deux valent 15 %, le calcul actuel (15 % de 185 €) donne exactement le bon montant. La commission par bloc ne se code que le jour où les taux divergent.

---

## 2. Le parcours, étape par étape

### 2.1 Les courses (carte et empreinte)

| # | Quand | Ce qui se passe | Côté Stripe |
|---|---|---|---|
| 1 | Réservation | Le client choisit l'option Courses et coche le mandat (en place). Il **enregistre une carte**, même s'il paie la prestation par avance immédiate (CGV 7.2). | `SetupIntent` avec `usage: off_session`, ou `setup_future_usage` si la prestation est payée par carte. L'authentification forte n'a lieu qu'une fois, ici. |
| 2 | Gel du menu (J-3) | La liste de courses est figée (lot 4). **Le client fixe son Budget Courses** (CGV 10.4) à partir de l'estimation proposée, **100 € au plus** (réglage admin). Ce montant est le plafond. | — |
| 3 | Avant les courses | Message in-app et e-mail, avec le bouton « Annuler les courses » et le délai fixé par le chef (décisions du 31/10). | — |
| 4 | Verrouillage (T-48 h) | **Empreinte de 100 €**, posée sans le client. Si elle passe, le chef reçoit « Budget garanti : 100 € ». Si elle échoue, le client a un lien pour valider ou changer sa carte avant le délai. À défaut, il fait ses courses lui-même (refus tardif). | `PaymentIntent` avec `capture_method: manual`, `off_session`, `on_behalf_of` et `transfer_data` vers le chef, `application_fee_amount: 0`. Validité : 7 jours (Mastercard), **4 jours et 18 heures (Visa sans le client)**. |
| 5 | Dans les 48 h avant T (CGV 10.5) | Le chef fait les courses **avec sa propre carte**, dans la limite de 100 €. | — |
| 6 | Dans les 24 h après l'achat (CGV 10.8) | Le chef dépose les tickets et les lignes : 69,34 €. Une ligne sans ticket n'est pas remboursée, sauf accord du client. Un total au-dessus du Budget est refusé : l'écart reste au chef. | — |
| 7 | Dès le dépôt | Le client voit les tickets et **peut contester une ligne pendant 48 h** (CGV 10.8). | — |
| 8 | 24 h après le dépôt (CGV 10.8) | **Prélèvement de 69,34 €.** Les 30,66 € restants sont libérés aussitôt. Une ligne contestée qui a son ticket est quand même prélevée, puis remboursée si la contestation est fondée : Stripe ne permet **qu'un seul prélèvement** par empreinte. | `capture` avec `amount_to_capture: 6934`. Garde-fou : prélèvement d'office 6 h avant l'expiration. Dans le pire cas (achat juste avant T), le prélèvement tombe à 96 h, sous les 114 h de Visa. |
| 9 | Prélèvement + 3 jours ouvrés, puis 1 à 2 jours | Les 69,34 € arrivent sur la banque du chef. **Total depuis l'achat : 5 à 9 jours.** Avec le versement instantané : environ 30 minutes après le prélèvement. | Paiement libéré à J+3 jours ouvrés (7 jours calendaires pour le premier versement d'un nouveau compte). |
| 10 | Après | Le client reçoit le **relevé de débours** avec les tickets dans ses documents (CGV 7.6). Le mandat particulier gagne la ligne Budget. Le chef reçoit un relevé mensuel de ses débours. | — |

### 2.2 La prestation et le forfait (avance immédiate)

| Quand | Ce qui se passe |
|---|---|
| Après la prestation (CGV 9.3) | Lab's Food transmet la demande de paiement à l'URSSAF pour le compte du chef : **185 €**, soit la prestation (165 €) et le forfait courses (20 €), avec le numéro SAP du chef. **Les courses n'y figurent jamais** (CGV 10.10). |
| Pendant 48 h | Le client valide ou conteste dans son espace URSSAF. Le silence vaut validation. |
| Environ 2 jours après la validation | L'URSSAF prélève au client **92,50 €**, la moitié de 185 €. |
| Environ 4 jours ouvrés après la validation | L'URSSAF verse au chef **185 €**, le prix entier. Elle paie même si le prélèvement du client échoue : dans ce cas, elle reprend la somme au chef 30 jours plus tard (statut 120). |
| Ensuite | Facture B de **33,30 € TTC** (27,75 € HT, plus la TVA), prélevée par SEPA. Le chef peut contester ce prélèvement pendant 8 semaines (règle SEPA). |

**Si le client paie la prestation par carte**, les 185 € sont prélevés par Stripe au nom du chef. Les 33,30 € de commission sont retenus en frais d'application. Le client récupère ses 92,50 € de crédit d'impôt l'année suivante.

### 2.3 Cas particuliers

| Situation | Ce qui se passe |
|---|---|
| Annulation ou rétractation avant le Verrouillage | Aucune empreinte, rien à faire. |
| Annulation ou rétractation après le Verrouillage, avant les courses | L'empreinte est annulée gratuitement. |
| Rétractation ou annulation après les courses | Les produits appartiennent au client et restent dus (CGV 15.3) : prélèvement du montant réel. |
| Le chef n'a pas fait les courses (empreinte refusée, refus tardif) | Avec l'avance immédiate, **la ligne forfait est simplement retirée de la demande URSSAF**, qui part après la prestation : il n'y a rien à rembourser. Si la prestation a été payée par carte à l'avance, le forfait est remboursé. |
| Réservation faite moins de 48 h avant T | L'empreinte est posée à la réservation, en présence du client : elle vaut 7 jours. |
| Le chef dépense plus que le Budget | **Impossible côté plateforme** (décidé le 11/11) : l'empreinte a un montant fixe et le prélèvement ne la dépasse jamais. L'API refuse un total de tickets au-dessus du Budget, et l'écart reste à la charge du chef. |
| Empreinte expirée (tickets très en retard) | Plus de garantie : nouvelle tentative de paiement sans le client, qui peut échouer. Le garde-fou de l'étape 8 rend ce cas rare. |
| Carte expirée ou en opposition avant le Verrouillage | Échec à l'étape 4. Rappel au client à J-3 si sa carte expire avant la séance. |
| Paiement URSSAF repris au chef (statut 120) | Le chef perd 185 €. **Lab's Food lui rend la commission** (décidé le 11/11) : un avoir de 33,30 € TTC, déduit de la prochaine facture B, ou remboursé s'il n'y en a pas. |
| Contestation bancaire sur les courses (jusqu'à 13 mois) | Le dossier de preuves est solide : mandat, budget fixé par le client, tickets. Le litige est d'abord débité à la plateforme, et repris au chef seulement s'il est en faute. |

---

## 3. Où passe l'argent

| Flux | Chemin | Lab's Food touche-t-elle l'argent ? |
|---|---|---|
| Courses (69,34 €) | Carte du client → Stripe, au nom du chef → compte Stripe du chef → sa banque | **Non** |
| Prestation + forfait (185 €), en avance immédiate | URSSAF → banque du chef ; client → URSSAF (92,50 €) | **Non** (l'URSSAF verse directement au chef) |
| Prestation + forfait (185 €), par carte | Carte du client → Stripe, au nom du chef → compte du chef, moins les frais d'application | Elle ne reçoit que sa commission |
| Commission (33,30 € TTC) | Chef → Lab's Food, par prélèvement SEPA (facture B) ou frais d'application | Oui : c'est sa recette |
| Avoir de commission (statut 120) | Lab's Food → chef, déduit de la facture B suivante ou remboursé | Oui : c'est son propre argent |

**Pourquoi les courses sont payées au nom du chef :**
- Lab's Food ne détient jamais l'argent des courses : pas d'agrément de paiement à demander, Stripe est l'établissement agréé.
- C'est cohérent avec le droit : le chef, qui achète à la place de Lab's Food (art. 1994), peut se faire rembourser directement par le client.
- Le client voit le même marchand que pour la prestation, et le code existe déjà.

Avec ce type de paiement, **Stripe facture toujours ses frais à la plateforme**. Lab's Food paie donc les frais des courses : c'est ce que finance la commission sur le forfait.

---

## 4. Juridique

### 4.1 Le fondement : le mandat de débours (CGV art. 10 et Annexe 3)
- **Art. 1984 et suivants du Code civil.** Le client mandate Lab's Food, et le chef achète à sa place (art. 1994).
- **Art. 1999.** Le mandant rembourse les avances de son mandataire. Le chef, qui achète à la place de Lab's Food, peut agir directement contre le client : c'est le fondement du remboursement.
- **L'empreinte** n'est pas un paiement, c'est une garantie. Les CGV l'annoncent (7.3).

### 4.2 Le régime fiscal des débours (CGI art. 267 II-2°, BOFiP TVA-BASE-10-20-40-60)
Les courses restent hors du chiffre d'affaires du chef, hors TVA et hors crédit d'impôt, si quatre conditions sont tenues :
- un mandat exprès (✔ la case et le PDF) ;
- le montant exact (✔ le prélèvement au réel) ;
- des justificatifs (✔ les tickets) ;
- un suivi à part.

Il faut donc :
- un **relevé de débours mensuel par chef**, que Lab's Food lui fournit ;
- **exclure les débours** des montants déclarés au fisc (DAC7) et de la future assiette du précompte des cotisations. Le forfait, lui, y entre.

### 4.3 Le forfait courses est une prestation de service
- **Crédit d'impôt.** La préparation de repas à domicile inclut « le temps passé aux commissions » (D.7231-1 du Code du travail). Le forfait est donc éligible : il va dans la demande URSSAF et sur la facture du chef, ce qui fait un argument de vente.
- **CGV à corriger** :
  - le **8.2** dit « y compris les Courses », ce qui contredit le 10.10. Il faut écrire que le forfait ouvre droit au crédit d'impôt, mais pas les courses ;
  - le **6.2** doit citer le forfait courses dans le Prix de la Prestation.
- **Le nom** (décidé le 11/11). Partout, on dit **« Forfait courses »**, avec un popover qui le définit. Jamais « frais de débours », qui fait penser à une marge sur les courses, ni « frais de service », que le 6.3 réserve aux frais de Lab's Food.
- **Pas de contradiction avec la gratuité du mandat** (10.3) : le mandat reste gratuit et aucune commission ne porte sur les courses. Le forfait rémunère le temps du chef, et les 15 % portent sur ce forfait.

### 4.4 L'avance immédiate
- La demande de paiement porte la prestation et le forfait. **Jamais les débours** (10.10).
- L'URSSAF verse le prix entier au chef. Si le client ne paie pas, elle reprend la somme au chef 30 jours plus tard (statut 120). Le risque existe déjà aujourd'hui. Dans ce cas, Lab's Food rend la commission au chef (décidé le 11/11).

### 4.5 L'information du client sur l'empreinte (L.111-1, L.221-5)
Les CGV définitives l'annoncent déjà (7.2, 7.3, 10.8). L'écran de réservation doit préciser trois choses :
- le montant bloqué, égal au Budget, 100 € au plus ;
- la durée du blocage, quelques jours au plus ;
- la libération immédiate de ce qui n'est pas prélevé.

**Le 10.4 et le plafond strict.** Le 10.4 interdit de dépasser le Budget « sans l'accord écrit du Client donné par la messagerie ». La plateforme ne prélève jamais au-delà de l'empreinte : elle est donc plus stricte que les CGV, ce qui est permis. Pour qu'un client ne donne pas par message un accord que la plateforme ne peut pas exécuter, la v1.1 des CGV peut retirer cette exception.

### 4.6 Carte enregistrée et paiements sans le client
Le client consent à l'enregistrement de sa carte et aux paiements faits plus tard sans lui, dans la limite du Budget. L'authentification forte n'a lieu qu'à l'enregistrement : la DSP2 dispense d'authentification les paiements initiés ensuite par le marchand.

### 4.7 Aucun frais de carte facturé au client (L.112-12 CMF)
Les frais Stripe restent à la charge de Lab's Food. **Le client ne voit jamais de ligne « frais de paiement ».** La commission est payée par le chef, entre professionnels, ce qui est autorisé.

### 4.8 Le taux, dans la relation avec les chefs
- **Règlement P2B (UE) 2019/1150.** Les conditions des chefs doivent indiquer clairement **15 % sur la prestation, les suppléments et le forfait courses, 0 sur les courses**. Toute modification, comme un taux propre au forfait, doit leur être notifiée **15 jours à l'avance**, et ils peuvent partir.
- **Les CGU** ne citent que « la commission ou l'abonnement » (art. 5). Le taux va dans les conditions des chefs ou leur page de tarifs. Les mentions légales (§5.3) parlent d'une « commission sur chaque prestation », ce qui reste exact.
- **TVA.** La commission porte 20 % de TVA (`vatRateBps 2000`). Un chef en franchise ne la récupère pas.
- **L'avoir du statut 120** est une facture d'avoir, numérotée dans la même suite que les factures B.

### 4.9 Ce qu'il ne faut pas faire
- **Faire passer les courses par le compte de Lab's Food** : ce serait encaisser pour le compte d'un tiers, une activité réservée (L.521-3 CMF).
- **Avancer le remboursement au chef sur les fonds de Lab's Food** : on toucherait au monopole bancaire du crédit (L.511-5 CMF). Pour accélérer, mieux vaut le versement instantané Stripe.

### 4.10 Données personnelles
- La carte reste chez Stripe (norme PCI DSS).
- Les tickets sont des pièces comptables, gardées 10 ans (politique de confidentialité, §11).
- Un ticket peut révéler des préférences (casher, sans gluten…) : il n'est visible que du client, du chef et de l'admin.

---

## 5. Finances

### 5.1 Ce que coûte Stripe (tarifs publics standard, à vérifier)

| Poste | Tarif | Qui paie |
|---|---|---|
| Prélèvement sur une carte de l'EEE, standard | 1,5 % + 0,25 € | Lab's Food |
| Carte EEE premium, carte britannique, carte hors EEE | 1,9 %, 2,5 % ou 3,25 %, + 0,25 € | Lab's Food |
| Empreinte posée puis libérée | Pas de frais en tarification standard (à confirmer) | — |
| Remboursement d'une ligne contestée | Les frais du paiement initial ne sont pas rendus | Lab's Food |
| Virement vers la banque du chef (Connect) | 0,25 % + 0,10 € | Lab's Food |
| Compte Connect actif | 2 € par mois et par chef payé dans le mois | Lab's Food. C'est un coût nouveau pour un chef payé seulement par l'URSSAF ou en CESU. |
| Prélèvement SEPA de la facture B | Environ 0,35 € par prélèvement (à vérifier). Un par chef et par mois en lot mensuel. | Lab's Food |
| Versement instantané (option) | Payant, en pourcentage (tarif à vérifier) | À décider |
| Contestation bancaire | Environ 20 € par litige | Lab's Food, repris au chef s'il est en faute |

### 5.2 L'exemple, pour chacun

| | Avance immédiate (exemple) | Si la prestation est payée par carte |
|---|---|---|
| **Le client paie** | 92,50 € (URSSAF) + 69,34 € (carte) = **161,84 €** | 185 € + 69,34 € = 254,34 €, puis 92,50 € de crédit d'impôt l'année suivante |
| **Le chef garde** | 185 € − 33,30 € = **151,70 €**. Il avance 69,34 €, qui lui sont rendus. | 151,70 € (les 33,30 € sont retenus sur le paiement) |
| **Lab's Food encaisse** | 27,75 € HT − 1,56 € (frais Stripe des courses) − environ 0,35 € (prélèvement SEPA) ≈ **25,84 €** | 27,75 € HT − 3,03 € (frais Stripe sur les 185 €) − 1,56 € ≈ **23,16 €** |
| **TVA sur la commission** | 5,55 €, collectés par Lab's Food et reversés à l'État ; non récupérables pour un chef en franchise | Pareil |

### 5.3 Le bloc courses paie-t-il ses frais ?
Ce bloc rapporte 15 % du forfait, soit 3 € HT sur un forfait de 20 €. Ses frais Stripe dépendent du **panier** : (1,5 % + 0,25 %) × panier + 0,35 €, avec une carte EEE standard. Le panier ne dépasse jamais le Budget, soit 100 € par défaut.

| Panier réel | Frais Stripe | Marge du bloc courses (forfait de 20 €) |
|---|---|---|
| 50 € | 1,23 € | +1,77 € |
| 69,34 € (l'exemple) | 1,56 € | +1,44 € |
| 90 € | 1,93 € | +1,07 € |
| 100 € (le plafond) | 2,10 € | +0,90 € |

**Panier jusqu'auquel les frais sont couverts, selon le forfait choisi par le chef :**

| Forfait courses | Commission (15 %) | Carte EEE standard | Carte EEE premium |
|---|---|---|---|
| 10 € | 1,50 € | 65 € | 53 € |
| 15 € (le minimum recommandé) | 2,25 € | 108 € | 88 € |
| 20 € | 3,00 € | 151 € | 123 € |
| 25 € | 3,75 € | 194 € | 158 € |

**Les deux garde-fous décidés le 11/11 suffisent :**
- avec un **Budget de 100 € au plus**, un forfait de **15 €** couvre toujours ses frais sur une carte standard. Le pire cas, une carte premium et un panier de 100 €, coûte 0,25 € ;
- le forfait minimum de 15 € est une **recommandation**, affichée dans le champ où le chef fixe son forfait. Un chef qui choisit 10 € coûte au plus 0,60 € par session à Lab's Food (panier de 100 €, carte standard).

### 5.4 Ce qui change par rapport à aujourd'hui

| | Aujourd'hui | Avec les deux blocs |
|---|---|---|
| Commission sur le forfait de 20 € | 15 %, soit 3,00 € HT | 15 %, soit 3,00 € HT (sans changement) |
| Ce que le chef garde du forfait, TVA comprise | 16,40 € | 16,40 € |
| Frais Stripe des courses pour Lab's Food | Aucun : le paiement des courses n'existe pas encore | Environ 1,56 € par session dans l'exemple |
| Bloc prestation | 15 % | 15 %, sans changement |

### 5.5 Un mois type
Hypothèses : 100 sessions avec courses, prestation moyenne de 165 €, forfait de 20 €, panier moyen de 90 €. 60 sessions sont payées par avance immédiate, 40 par carte. Le mois compte 25 chefs, dont 10 payés seulement par l'URSSAF, et une contestation bancaire.

| | Montant |
|---|---|
| Commission (100 × 27,75 €) | **2 775 € HT** |
| Frais Stripe des courses (avec 15 % de cartes premium ou étrangères) | ≈ 220 € |
| Frais Stripe des prestations payées par carte (40 × 3,03 €) | ≈ 121 € |
| Prélèvements SEPA des factures B (25 × 0,35 €) | ≈ 9 € |
| Comptes Connect des chefs payés seulement par l'URSSAF | ≈ 20 € |
| Contestation bancaire | ≈ 20 € |
| **Résultat, avant le temps de support** | **≈ 2 385 € HT** |
| Dont bloc courses seul : 300 € − 260 € | ≈ +40 € |

À 15 %, **le bloc courses ne fait que couvrir ses frais** : il ne finance pas le temps de support (contrôle des tickets, contestations, empreintes refusées), qui sera son premier coût caché. Une reprise URSSAF (statut 120) coûte en plus 27,75 € HT de commission rendue.

### 5.6 La trésorerie du chef
- **Pour les courses**, un chef qui fait 8 sessions par mois avec 100 € de courses chacune avance en moyenne environ **160 €** en permanence. Son tout premier remboursement prend environ 9 à 10 jours. Avec le versement instantané, l'avance retombe à 1 ou 2 jours.
- **Pour la prestation payée par avance immédiate**, il attend environ 4 jours ouvrés après la validation du client, puis subit le prélèvement SEPA de sa commission.

---

## 6. Avantages et risques, pour chacun

### Le client
| Avantages | Risques et inconvénients |
|---|---|
| Le forfait courses profite de l'avance immédiate : il n'en paie que la moitié. | Il doit enregistrer une carte, même s'il paie par l'URSSAF (CGV 7.2). |
| Il ne paie que le montant réel des courses, au centime, après les achats. Jamais au-delà du Budget qu'il a fixé. | Jusqu'à 100 € bloqués pendant 4 jours environ. Sur une carte à débit immédiat, cela réduit son solde disponible. |
| Il voit les tickets et peut contester une ligne pendant 48 h. | Deux débits à des dates différentes (la carte pour les courses, l'URSSAF pour la prestation), et une empreinte visible dans son appli bancaire. Il faut lui expliquer. |
| Aucun frais de paiement. | Si l'empreinte échoue, il doit réagir vite, ou faire ses courses lui-même. |

### Le batch cooker
| Avantages | Risques et inconvénients |
|---|---|
| Son forfait est payé avec la prestation, et il ouvre droit au crédit d'impôt pour le client : c'est un argument de vente. | Il paie 15 % de commission sur son forfait, comme aujourd'hui, et ne récupère pas la TVA s'il est en franchise. |
| **Son remboursement est garanti** par l'empreinte, dans la limite du budget. | **Il avance 5 à 9 jours**, ou 1 à 2 jours avec le versement instantané. |
| Pas de facture de courses à faire : les tickets dans l'application suffisent, et Lab's Food fournit le relevé. | Ce qui dépasse le Budget et un ticket perdu restent à sa charge. |
| Les débours restent hors de son chiffre d'affaires. Sa commission lui est rendue si l'URSSAF reprend son paiement. | Un compte Stripe complet devient obligatoire, même s'il n'encaisse que par l'URSSAF. Il reste exposé à la reprise URSSAF (statut 120) pour les 185 €. |

### Lab's Food
| Avantages | Risques et inconvénients |
|---|---|
| 27,75 € HT par session dans l'exemple. Avec le plafond de 100 €, le bloc courses couvre ses frais dès un forfait de 15 €. | Elle paie les frais Stripe des courses, et le bloc courses ne dégage presque rien à 15 % (§5.5). |
| Elle ne détient jamais l'argent des courses ni de la prestation : pas d'agrément de paiement. | Les litiges bancaires lui sont débités d'abord. Elle rend la commission en cas de reprise URSSAF. Le support (tickets, contestations) prend du temps. |
| Le circuit existe (Connect au nom du chef, facture B), et le calcul de la commission ne change pas. | Tout le lot 6 est à construire, plus l'avoir de commission. |
| Les preuves sont solides : mandat, budget fixé par le client, tickets. | La fenêtre Visa de 4 jours et 18 heures, et la conformité : CGV (8.2, 6.2, 10.4), préavis de 15 jours aux chefs, déclarations DAC7. |

### Les risques principaux et leurs parades

| Risque | Probabilité | Qui le supporte | Parade |
|---|---|---|---|
| Empreinte refusée au Verrouillage | Faible à moyenne | Client et chef | Carte vérifiée à l'enregistrement ; rappel si elle expire ; lien pour s'authentifier ; refus tardif ; ligne forfait retirée de la demande URSSAF. |
| Empreinte expirée avant le prélèvement | Faible | Chef | Tickets sous 24 h ; prélèvement d'office 6 h avant l'expiration. |
| Petit forfait, gros panier | Faible avec le plafond | Lab's Food | Budget de 100 € au plus ; forfait de 15 € recommandé. |
| Dépassement de budget | Moyenne | Chef | Budget affiché pendant les courses ; total des tickets refusé au-dessus du Budget. |
| Ticket perdu ou illisible | Moyenne | Chef | Photo dès l'achat ; ligne non remboursée sauf accord du client. |
| Ligne contestée | Faible | Arbitrage de l'admin | Le ticket fait preuve ; prélèvement puis remboursement si le client a raison. |
| Reprise URSSAF (statut 120) | Faible | Le chef pour les 185 €, Lab's Food pour la commission rendue | Suivi des statuts 60 et 120 (déjà prévu) ; avoir automatique. |
| Contestation bancaire | Faible | Lab's Food, puis le chef s'il est en faute | Dossier de preuves automatique ; règle écrite dans les conditions des chefs. |
| Chef sans trésorerie | Moyenne au lancement | Chef, puis la qualité du service | Versement instantané ; Budget plafonné à 100 €. |

---

## 7. Les décisions

**Décidé le 11/11 :**
- Stripe Issuing écarté ; option B retenue (empreinte, avance du chef).
- La commission en deux blocs : la prestation et les suppléments d'un côté, le forfait courses de l'autre, rien sur les débours.
- Le forfait payé avec la prestation, et les débours uniquement par carte.
- Les règles des CGV 10.8 : prélèvement 24 h après les tickets, 48 h pour contester.
- Options écartées : un taux unique de 30 à 35 % sur le forfait, et la refacturation au chef du coût Stripe réel.
- **Reprise URSSAF (statut 120)** : la commission est rendue au chef.
- **Dépassement du Budget** : impossible. L'empreinte a un montant fixe, le prélèvement ne la dépasse jamais, et l'écart reste au chef. La plateforme est plus stricte que le 10.4, ce qui est permis.
- **Garde-fous** : Budget Courses de **100 € au plus** par défaut (réglage admin) ; forfait courses de **15 € minimum recommandé**, affiché dans le champ où le chef le fixe, sans blocage.
- **Taux du forfait** : **15 %, pour tous les paliers**, pour l'instant.
- **Le nom** : « Forfait courses » partout (site, factures, CGV), avec un popover qui le définit.

**À décider :**
1. **Les lignes contestées** : prélevées puis remboursées (recommandé), ou laissées de côté (perdues pour le chef si la contestation échoue) ?
2. **Le versement instantané** : proposé aux chefs ? Payé par qui ?
3. **Une contestation bancaire perdue** sur des courses justifiées : à la charge de Lab's Food (recommandé) ou du chef ?

---

## 8. Le travail

Le détail par équipe est dans le **lot 6 du plan « Module Recettes »** (artifact, version 4). En résumé :

**API (LF-BackEnd)**
- **La commission** : rien à changer. Le calcul actuel prend déjà 15 % sur la prestation et le forfait. Les paiements de courses n'ont jamais de commission. La commission par bloc ne se code que le jour où les deux taux divergent.
- **L'avoir de commission** au statut 120 : déduit de la prochaine facture B, ou remboursé s'il n'y en a pas.
- **Les réglages admin** : Budget Courses maximum (100 €) et forfait minimum recommandé (15 €).
- **La demande URSSAF** : la prestation et le forfait sur deux lignes, jamais les débours. La ligne forfait disparaît si les courses n'ont pas été faites.
- **Le lot 6** :
  - la carte enregistrée ;
  - le Budget fixé par le client, sous le plafond ;
  - la tâche planifiée « empreinte au Verrouillage », avec les échecs ;
  - les tickets, le refus au-dessus du Budget et le délai de contestation ;
  - le prélèvement partiel et le garde-fou d'expiration ;
  - les remboursements, avec reprise au chef ;
  - `purpose: courses` sur les paiements ;
  - les relevés de débours ;
  - l'exclusion des débours dans DAC7 ;
  - les notifications.

**Front** : le §3 de `cgv-v1-front.plan.md`, le récapitulatif en deux blocs (W1), « Forfait courses » et son popover partout, le champ du forfait avec la recommandation, et le taux affiché sur la page de rémunération du chef.

**Documents**
- CGV : corriger 8.2 et 6.2, retirer l'exception du 10.4, et les coquilles du 4.4 et du 10.8. Après le 21/11, ce sera une version 1.1.
- Mandat v2 : la ligne Budget et l'empreinte.
- Conditions des chefs : le taux, les tickets, le plafond, l'écart à leur charge, l'avoir du statut 120, les litiges, notifiés 15 jours avant.
- Politique de confidentialité : la carte enregistrée et les tickets.

**Stripe**
- Vérifier les tarifs du compte.
- Activer le versement instantané, si c'est retenu.
- Exiger un compte Connect complet de tout chef qui propose l'option Courses.
