# Module Recettes — sous-projet 1 : le socle recette, sur le lot 2

> Conception validée en séance le 04/11/2026, puis révisée le même jour pour partir de `develop`.
> Source : « LAB'S FOOD — Document fonctionnel — Module Recettes » v2.0 (fichier `Recettes V4.pdf`), citée ci-dessous « la V4 » avec ses numéros de section et de règle (§4.11, R8…).
> Point de départ : le lot 2 « Fiche recette » de l'équipe, fusionné dans `develop` (API #75, espace chef #60) et en attente de PR pour la console (`origin/feat/recettes-lot-2`). Ce document ne décrit que ce qui change par rapport à `develop`.
> Dépôts concernés : `LF-BackEnd` (API), `admin-dashboard` (console), `batchcooking-web` (espace chef).

## 1. Objectif

À la fin du socle :

- chaque ligne d'une recette est reliée à un ingrédient de la liste commune, ou à un ingrédient que le chef a créé et que LAB'S FOOD valide ensuite ;
- les allergènes sont calculés à partir des ingrédients, comme le sont déjà les régimes et les saisons ;
- une recette n'est « Prête » que si le contrôle §4.11 complet passe ;
- LAB'S FOOD tient la liste commune dans la console : allergènes, rayon, validation des ingrédients des chefs, import CSV, liste de départ d'environ 300 ingrédients ;
- une modification d'un ingrédient par LAB'S FOOD se reporte sur les recettes, et les chefs concernés sont prévenus ;
- le chef consulte l'historique de ses versions et peut en restaurer une ;
- les plats existants sont repris sans être retirés de la vente.

## 2. Découpage du module

| # | Sous-projet | État |
|---|---|---|
| **1** | **Socle recette** (ce document) | À faire, sur le lot 2 |
| 2 | Bibliothèque : recherche, filtres, actions groupées, partage entre chefs | Duplication et PDF déjà livrés par le lot 2 |
| 3 | Vitrine : publier, retirer, aperçu client, modération | Régimes, saisons et profils déjà sur la vitrine (lot 2) |
| 4 | IA | Bloqué (BLK-30) |
| 5 | Import | Après 4 |
| 6 | Menu de prestation | Le figement du menu fait partie du lot 3 « Menu figé et conservation » (LF-0268, LF-0269) |
| 7 | Liste de courses V2 : unité d'achat, conditionnement, arrondis « faciles à acheter » | Après 6 |
| 8 | Mandat de débours | Après 7 |
| 9 | Fiche de conservation | Lot 3 |

## 3. Repris du lot 2 sans changement

- La recette reste dans `meals`. Les lignes d'ingrédients et les étapes y sont stockées en JSON. Les versions restent dans `meal_recipe_versions`, et une réservation garde la version qu'elle a figée.
- Une version est créée quand une recette modifiée redevient « Prête », ou quand le chef confirme les allergènes. Une sauvegarde automatique n'en crée jamais.
- `allergens_verified_at`, `POST /me/dishes/:id/allergens/confirm`, et la réservation refusée sans vérification (`ALLERGENS_UNVERIFIED`). Un plat publié dont la vérification est effacée reste publié mais n'est plus réservable.
- `readiness { ready, problems, toPublish, warnings }`, et `RECIPE_NOT_READY` à la publication.
- Régimes et saisons calculés dans `classification`, « non calculé » tant qu'une ligne n'est pas reliée. Les saisons peuvent être remplacées par le chef (`seasons_override`), et les régimes halal et casher sont déclarés par lui (`declared_diets`).
- Profils, étiquettes personnelles, étapes typées (`preparation`, `cuisson`, `refroidissement`, `mise_en_boite`).
- Modes de réchauffage et profils dans deux listes réglables (`listInForce`).
- Matériel en texte libre, jamais contrôlé. Une seule photo principale (`image_url`).
- Plafonds : 60 lignes d'ingrédients, 40 étapes, 2 000 caractères par étape (`LIMIT_REACHED`).
- Portions : quantité fixe, aucun arrondi avant l'addition, un enfant compte pour une demi-portion.
- Routes `/me/dishes` et `/admin/meals`. Codes de régimes `no-pork` et `pescetarian`, mode de réchauffage `none`.
- Table `notifications` (type et sujet, sans texte) et cloche dans les deux espaces.

## 4. Décisions

| Sujet | Décision |
|---|---|
| Base | Le socle s'écrit sur le lot 2 ; les choix de l'équipe du §3 sont gardés. |
| Saisie d'un ingrédient | Choix dans la liste commune. S'il manque, le chef crée son ingrédient, utilisable tout de suite par lui et privé jusqu'à validation par LAB'S FOOD. |
| Liste de départ | Préparée par IA (environ 300 ingrédients), relue et corrigée par LAB'S FOOD dans la console avant la mise en production. |
| Allergènes | Calculés à partir des ingrédients. Le chef peut en ajouter, pas en retirer, et confirme toujours avant que le plat soit réservable. Un allergène ajouté par le chef s'affiche comme un allergène calculé. |
| Ingrédient facultatif | Ses allergènes sont affichés « si utilisé », mais comptent comme les autres dans le contrôle des allergies du client (lot 1). Il compte pour les régimes et est ignoré pour les saisons. |
| Contrôle « Prête » | Contrôle V4 complet (§6.4). Les recettes existantes incomplètes perdent « Prête » ; les plats publiés restent en ligne. |
| Plats existants | Lignes reliées automatiquement quand c'est possible, sinon « à vérifier ». Rien n'est dépublié. Les allergènes déjà déclarés deviennent « ajoutés par le chef ». La vérification n'est effacée que si le calcul trouve un allergène nouveau. |
| Unités | Liste fixe de 14 unités. Une unité inconnue à la reprise rend la ligne « à vérifier ». |
| LAB'S FOOD modifie un ingrédient | Report immédiat sur les recettes qui l'utilisent. Si leurs allergènes changent, la vérification est effacée et le chef est prévenu dans l'outil et par e-mail. |
| Précision d'achat | Les variétés sont des ingrédients distincts (oignon rouge, oignon jaune). La précision est un texte court facultatif (« bio », « fermier »). |
| Rayons | Liste réglable comme les modes de réchauffage ; 13 rayons au départ. Le rayon est porté par l'ingrédient, et l'API le recopie sur la ligne. |
| Types de plat | Les 7 de la V4 : on ajoute soupe, petit-déjeuner ou goûter, sauce ou base aux 4 actuels. |
| Conflit entre deux onglets | `lockVersion` facultatif sur l'enregistrement ; une valeur périmée répond `409 RECIPE_CONFLICT`. |
| Restaurer une version | Recharger la version dans la recette, recalculer, puis suivre les règles habituelles. L'historique n'est jamais effacé. |
| Arrondis | Règles par unité, à l'affichage seulement (§6.6). |
| Hors socle | Unité d'achat, poids d'une pièce et conditionnement passent au sous-projet 7, seul à s'en servir. |

## 5. Données

Une migration, écrite comme celles du lot 2 (rejouable, `IF NOT EXISTS`), puis une seconde, additive, pour `carry_pending_at` (R28).

### 5.1 Liste commune — `catalog_ingredients` (étendue)

| Colonne | Règle |
|---|---|
| `normalized_name` | Nom sans accents, en minuscules, espaces réduits. Sert à la recherche et à l'unicité. |
| `aisle` | Code de rayon (§5.4). Nul : « à compléter ». |
| `allergens`, `allergens_none` | Codes des 14 allergènes, ou « aucun » coché explicitement. Une contrainte CHECK interdit les deux à la fois. Ni l'un ni l'autre : « à compléter ». |
| `is_basic` | Ingrédient de base (sel, poivre, huile…). Préremplit « caché au client » sur une ligne. |
| `chef_profile_id` | Nul : ingrédient commun. Sinon : ingrédient privé de ce chef. |
| `status` | `active`, `pending` (privé, utilisable par son chef), `inactive` (plus proposé, reste valable sur les lignes qui l'ont), `merged` (privé remplacé par un commun). |
| `merged_into_id` | L'ingrédient commun qui le remplace. |
| `created_by_user_id`, `reviewed_at`, `reviewed_by_user_id` | Auteur ; relecture par LAB'S FOOD. |
| `carry_pending_at` | Report en attente (§7.3, R28). Rempli dans la même transaction qu'une modification à reporter ; effacé seulement quand un report ou une relance de cet ingrédient se termine sans plat en échec. La console liste ces ingrédients (`carryPending`) pour relancer le report. |

L'index unique actuel sur `name` est remplacé par deux index partiels : `normalized_name` unique parmi les ingrédients communs, et (`chef_profile_id`, `normalized_name`) unique parmi les ingrédients `pending`. Les régimes gardent leurs garde-fous à l'écriture : `vegan` implique `vegetarian`, et `vegetarian` implique `no-pork` et `pescetarian`.

Un ingrédient « à compléter » (sans rayon ni allergènes renseignés) peut être relié, mais la recette ne passe pas « Prête » (§6.4).

### 5.2 Ligne d'ingrédient (JSON de `meals.ingredients` et des versions)

Champs actuels : `name`, `qty`, `unit`, `aisle`, `link`, `toVerify`, `fixedQuantity`, `catalogIngredientId`.

| Champ | Règle |
|---|---|
| `catalogIngredientId` | Facultatif à l'enregistrement, obligatoire pour être « Prête ». |
| `name`, `aisle` | Pour une ligne reliée, l'API recopie le nom et le rayon de l'ingrédient ; ce qu'envoie l'écran est ignoré. |
| `unit` | L'une des 14 unités : `g`, `kg`, `ml`, `cl`, `l`, `tsp`, `tbsp`, `piece`, `clove`, `bunch`, `slice`, `leaf`, `pinch`, `to_taste`. Peut être nulle seulement sur une ligne « à vérifier ». |
| `qty` | Strictement positive. Nulle avec `to_taste`, ou sur une ligne « à vérifier ». |
| `optional` (nouveau) | Ingrédient facultatif. |
| `precision` (nouveau) | Précision d'achat, 60 caractères. |
| `preparation` (nouveau) | « émincé », « en dés », 120 caractères. |
| `group` (nouveau) | « Pour la sauce », 60 caractères. |
| `hiddenFromClient` (nouveau) | Prérempli à partir de `is_basic`. |
| `rawText` (nouveau) | Texte d'origine d'une ligne « à vérifier » (reprise, plus tard import et IA), 200 caractères. |
| `allergens`, `incomplete` (nouveaux, écrits par l'API) | Les allergènes de l'ingrédient au dernier calcul, et « ingrédient à compléter ». Recopiés à chaque enregistrement et à chaque report (§7.3). Le calcul du plat se fait ainsi à partir des lignes seules, et chaque version garde les allergènes de ses ingrédients. |

Deux lignes du même groupe, reliées au même ingrédient avec la même précision, sont un doublon (R10).

### 5.3 Recette — `meals` (étendue)

| Colonne | Règle |
|---|---|
| `added_allergens` | Allergènes ajoutés par le chef (codes des 14). |
| `conditional_allergens` | Allergènes apportés seulement par des lignes facultatives (calculé). |
| `allergens`, `allergens_none` | Deviennent calculés (§6.1). Leurs lecteurs ne changent pas : contrôle des allergies (lot 1), vitrine, fiche mission, PDF, modération. |
| `lock_version` | Entier, +1 à chaque écriture de la recette, y compris par le report du §7.3. |
| `storage` (JSON) | Ajoute `freezable` (oui, non, ou absent tant que non renseigné), `freezerMonths` (1 à 24), `thawing` (300 caractères). |
| `category` | 7 codes : `main`, `starter`, `soup`, `side`, `dessert`, `breakfast`, `sauce`. |

`custom_allergens` (texte libre « Autre ») reste écrit par le chef et s'affiche avec les autres.

### 5.4 Listes réglables

Nouvelle liste `recipe_aisles`, sur le modèle de `reheat_modes`. Par défaut, dans l'ordre de parcours en magasin :

`fruits-legumes` Fruits et légumes (y compris herbes fraîches), `boulangerie` Boulangerie, `boucherie` Boucherie et volaille, `poissonnerie` Poissonnerie, `cremerie` Crèmerie et œufs, `fromages` Fromages, `epicerie-salee` Épicerie salée (pâtes, riz, légumineuses, sauces), `conserves` Conserves et bocaux, `epices` Épices, herbes sèches et condiments, `epicerie-sucree` Épicerie sucrée, `boissons` Boissons, `non-alimentaire` Non alimentaire (boîtes, papier cuisson…), `surgeles` Surgelés.

La liste de courses regroupe par code de rayon, dans cet ordre.

### 5.5 Notifications

La table `notifications` reçoit quatre nouveaux types :

| Type | Sujet | Destinataire | Canal |
|---|---|---|---|
| `recipe_allergens_changed` | le plat | Chef propriétaire | Dans l'outil, et un e-mail par chef et par opération (`BREVO_TPL_RECIPE_ALLERGENS_CHANGED`) |
| `ingredient_validated` | l'ingrédient | Chef auteur | Dans l'outil |
| `ingredient_merged` | l'ingrédient | Chef auteur | Dans l'outil |
| `recipes_migrated` | le profil du chef | Chaque chef, une fois | Dans l'outil et par e-mail (`BREVO_TPL_RECIPES_MIGRATED`) |

Comme le reste de la table, une notification ne contient ni allergène ni donnée personnelle : l'écran va chercher le sujet.

## 6. Règles de calcul

Des fonctions sans accès à la base, dans `modules/dishes/domain/`, avec un test par règle.

### 6.1 Allergènes

- `allergens` = union des allergènes des ingrédients de toutes les lignes reliées (de base, cachées et facultatives comprises), plus `added_allergens`.
- `conditional_allergens` = les allergènes apportés seulement par des lignes facultatives, et pas ajoutés par le chef. Ils restent dans `allergens` : le contrôle des allergies du client les compte.
- `allergens_none` = vrai seulement si chaque ligne est reliée à un ingrédient dont les allergènes sont renseignés, et que `allergens` et `custom_allergens` sont vides.
- Une ligne non reliée n'apporte rien. Une ligne reliée apporte toujours les allergènes que son ingrédient porte, même « à compléter » : l'ingrédient peut n'y manquer que le rayon, et les ignorer sous-déclarerait. Une ligne non reliée, un ingrédient « à compléter » ou un code d'allergène inconnu rendent seulement l'état incomplet : le code inconnu est gardé, après ceux de l'annexe. Un état incomplet empêche « Prête » et la confirmation des allergènes.
- Le chef ne peut pas retirer un allergène calculé : l'API n'accepte en écriture que `addedAllergens` et `customAllergens`.
- La vue d'un plat renvoie aussi, pour chaque allergène, les ingrédients qui l'apportent (« Lait : beurre, crème »).

### 6.2 Régimes

- Le calcul du lot 2 ne change pas : toutes les lignes comptent, facultatives comprises.
- `gluten-free` disparaît dès que `gluten` figure dans `allergens`, calculé ou ajouté.
- Halal ou casher déclaré sur une recette dont les régimes calculés n'incluent pas `no-pork` : problème `DECLARED_DIET_NOT_ALLOWED` au contrôle « Prête ».
- À l'affichage client, `gluten-free` et `lactose-free` sont suivis de « traces possibles pendant la préparation ».

### 6.3 Saisons

- Les lignes facultatives sont ignorées ; le reste du calcul du lot 2 ne change pas.
- Si les ingrédients saisonniers n'ont aucun mois en commun, l'alerte `NO_COMMON_SEASON` s'affiche, sans rien bloquer.

### 6.4 Contrôle « Prête » et publication

| Point | Lot 2 | Socle |
|---|---|---|
| Nom, type de plat, portions ≥ 1, temps de cuisson | ✓ | ✓ |
| Au moins un ingrédient, aucune ligne « à vérifier » | ✓ | ✓ |
| Chaque ligne reliée (`INGREDIENT_NOT_LINKED`) à un ingrédient complet (`INGREDIENT_INCOMPLETE`) | | ✓ |
| Chaque ligne avec une quantité > 0 et une unité, sauf `to_taste` | | ✓ |
| Au moins une étape, chacune typée | ✓ | ✓ |
| Conservation : méthode et jours | ✓ | ✓ |
| Congelable oui ou non ; si oui, mois au congélateur et décongélation | | ✓ |
| Au moins un mode de réchauffage | ✓ | ✓ |
| Consignes de réchauffage (`reheating.note`) | | ✓ |
| Allergènes vérifiés | ✓ | ✓ |
| Halal ou casher seulement sur une recette `no-pork` | | ✓ |
| **Publier** : description courte | ✓ | ✓ |
| **Publier** : au moins un ingrédient visible du client | | ✓ |
| **Publier** : photo principale | alerte | ✓ |

Chaque problème garde le format du lot 2, `{ code, field, message }`, avec `field` qui désigne le champ (`recipe.ingredients[3].qty`). La photo manquante garde son code `PHOTO_MISSING`, mais passe des alertes aux points à remplir pour publier. Alertes sans blocage : `NO_COMMON_SEASON`, et `FRIDGE_LONG` au-delà de 4 jours au réfrigérateur.

### 6.5 Revérification des allergènes

`allergens_verified_at` est effacé quand :

- une ligne est ajoutée ou retirée, ou qu'elle change d'ingrédient (le nom compte pour une ligne non reliée) ;
- une ligne devient facultative ou cesse de l'être ;
- `added_allergens` ou `custom_allergens` changent ;
- les allergènes calculés changent à cause de la liste commune (§7.3), d'une restauration (§8.2) ou de la reprise (§9).

Les autres changements ne l'effacent pas, comme dans le lot 2 : quantité, unité, précision, préparation, groupe, rayon, étapes, réchauffage, conservation, classement.

### 6.6 Portions et arrondis

- Mise à l'échelle du lot 2 inchangée. Une ligne `to_taste` n'a pas de quantité ; la liste de courses la garde, sans quantité.
- Les arrondis s'appliquent à l'affichage seulement : fiche, PDF et fin de la liste de courses. Ils remplacent l'arrondi actuel (deux décimales, pièces à l'unité supérieure) :

| Unités | Arrondi |
|---|---|
| `piece`, `clove`, `bunch`, `slice`, `leaf`, `pinch` | Unité supérieure |
| `g`, `ml` | 1 décimale sous 10 ; entier de 10 à 100 ; à 5 près au-delà |
| `kg`, `l`, `cl` | 2 décimales, sans zéros inutiles |
| `tsp`, `tbsp` | Au demi le plus proche, ½ au minimum |
| `to_taste` | Pas de nombre |

- L'API porte la règle (`displayQuantity`). L'espace chef en garde une copie pour l'aperçu des portions, vérifiée avec les mêmes valeurs.

## 7. Liste commune et ingrédients des chefs

### 7.1 Côté chef

- La recherche propose les ingrédients communs actifs et les ingrédients `pending` du chef, jamais ceux d'un autre chef.
- Si rien ne correspond, le chef crée son ingrédient : nom, rayon, allergènes ou « aucun » (obligatoires), et en option régimes, mois et « de base ». Si le nom correspond au nom ou à l'un des autres noms d'un ingrédient commun, ou à l'un de ses propres ingrédients en attente, la réponse `409 INGREDIENT_ALREADY_LISTED` (code déjà utilisé par la console) renvoie cet ingrédient pour que le chef le choisisse.
- Au plus 50 créations par chef et par jour (`429 INGREDIENT_CAP_REACHED`).
- Le chef modifie son ingrédient tant qu'il est `pending`. La modification se reporte sur ses plats (§7.3).
- « Mes ingrédients » liste ceux qu'il a créés : en attente, validés, ou remplacés par un ingrédient commun.

### 7.2 Côté LAB'S FOOD

- Créer et modifier un ingrédient commun (nouveaux champs du §5.1), le désactiver.
- Avant d'enregistrer un changement d'allergènes, de régimes ou de mois, voir l'impact : nombre de plats, de chefs et de plats vérifiés qui perdront leur vérification.
- File « À valider » :
  - **Valider** : l'ingrédient devient commun (`chef_profile_id` nul, `active`), et l'auteur reçoit `ingredient_validated`.
  - **Fusionner avec…** : un ingrédient commun le remplace (`merged`), les lignes de ses plats sont repointées (§7.3), et l'auteur reçoit `ingredient_merged`.
  - **Corriger puis valider.**
- Marquer un ingrédient comme relu, et suivre ce qui reste à relire dans la liste de départ.

### 7.3 Report d'une modification sur les recettes

Il se déclenche quand LAB'S FOOD change le nom, le rayon, les allergènes, les régimes ou les mois d'un ingrédient, quand LAB'S FOOD fusionne un ingrédient, et quand un chef modifie son ingrédient privé.

Pour chaque plat dont une ligne relie l'ingrédient (plats des chefs et recettes LAB'S FOOD), dans une transaction par plat :

1. Le nom et le rayon de la ligne sont recopiés ; en cas de fusion, la ligne est repointée.
2. `allergens`, `conditional_allergens`, `allergens_none` et `classification` sont recalculés, et `lock_version` augmente de 1.
3. Si le nom a changé, ou en cas de fusion, `version_pending` passe à vrai : la prochaine version reprendra le contenu à jour.
4. Si les allergènes ont changé et que le plat était vérifié, la vérification est effacée. Le plat reste publié mais n'est plus réservable, et le chef reçoit `recipe_allergens_changed`.

Les prestations déjà validées gardent leur version (lot 2). L'opération est rejouable sans effet en double et laisse une trace dans le journal d'audit avec ses chiffres.

Un report interrompu (redémarrage du serveur pendant l'opération) ne reste jamais silencieux : la modification marque l'ingrédient « report en attente » (`carry_pending_at`, R28) dans sa propre transaction, et seul un report ou une relance terminé sans plat en échec efface la marque. Rien n'est relancé au démarrage : LAB'S FOOD relance depuis la console.

### 7.4 Import CSV et liste de départ

- Fichier `apps/prisma/data/ingredients-v1.csv`, préparé par IA : environ 300 ingrédients courants répartis sur les 13 rayons.
- Format : séparateur `;`, listes séparées par `|`, booléens `oui`/`non`.
- Colonnes : `nom`, `autres_noms`, `rayon`, `allergenes`, `aucun_allergene`, `regimes`, `mois`, `base`, `doute` (ce qui mérite une attention particulière à la relecture, non importé).
- L'import se fait dans la console. Il simule d'abord (créés, mis à jour, inchangés, erreurs par ligne), et n'écrit rien s'il y a une erreur. Une fois confirmé, il met à jour un ingrédient existant par son `normalized_name` ; une mise à jour passe par le report du §7.3.
- Limites : 500 000 caractères et 2 000 lignes (R29 : la limite de 1 Mio du corps d'une requête rendait 2 Mo inatteignables).
- LAB'S FOOD relit chaque ingrédient sur l'environnement de développement. La mise en production attend que tout soit relu.

## 8. API

### 8.1 Recettes : `/me/dishes` et `/admin/meals`

- Les lignes d'ingrédients prennent la forme du §5.2.
- `addedAllergens` est ajouté. `allergens` et `allergensNone` sortent des corps d'écriture : les envoyer répond `400`, parce que les champs non déclarés sont refusés (`forbidNonWhitelisted`).
- La vue renvoie en plus `addedAllergens`, `conditionalAllergens`, les ingrédients qui apportent chaque allergène, et `lockVersion`.
- `lockVersion` est facultatif dans le corps. S'il est envoyé et périmé, la réponse est `409 RECIPE_CONFLICT` avec la valeur actuelle, et rien n'est écrit.
- Un ingrédient relié doit être accessible :
  - un ingrédient commun actif ;
  - un ingrédient privé `pending` du propriétaire du plat (jamais pour une recette LAB'S FOOD) ;
  - un ingrédient commun désactivé, seulement s'il était déjà sur la ligne.

  Sinon : `422 VALIDATION_FAILED` sur la ligne.
- Doublon R10 : `422 DUPLICATE_INGREDIENT_LINE` avec les lignes en cause.
- Confirmer les allergènes est refusé tant qu'une ligne n'est pas reliée ou qu'un ingrédient est « à compléter » : `422 INGREDIENT_NOT_LINKED`, avec les lignes en cause.
- La duplication et l'adoption d'une proposition LAB'S FOOD recopient les nouveaux champs.

### 8.2 Historique et restauration (nouveau)

| Route | Rôle |
|---|---|
| `GET /me/dishes/:id/versions` | Versions, de la plus récente à la plus ancienne : numéro, date, nombre de prestations qui l'utilisent, version courante ou non. |
| `GET /me/dishes/:id/versions/:version` | Contenu d'une version : portions, ingrédients, étapes, réchauffage, conservation. |
| `POST /me/dishes/:id/versions/:version/restore` | Recopie la version dans le plat. Une ligne reliée à un ingrédient fusionné depuis est repointée. Ensuite, mêmes règles qu'un enregistrement : recalcul, §6.5, `version_pending`, et nouvelle version si la recette est « Prête ». |

### 8.3 Ingrédients

| Route | Rôle |
|---|---|
| `GET /ingredients?search=` (existe) | Ajoute les ingrédients `pending` de l'appelant, signalés `private`. Renvoie aussi rayon, allergènes, « aucun », « de base » et statut. |
| `POST /me/ingredients`, `GET /me/ingredients`, `PATCH /me/ingredients/:id` | §7.1. |
| `GET /admin/ingredients` (existe) | Ajoute les filtres `status`, `aisle`, `incomplete` et `reviewed`. |
| `POST /admin/ingredients`, `PATCH /admin/ingredients/:id` (existent) | Nouveaux champs ; une modification déclenche le §7.3 ; `status: inactive` désactive. |
| `GET /admin/ingredients/:id/impact` | §7.2. |
| `POST /admin/ingredients/:id/validate`, `POST /admin/ingredients/:id/merge` (`{ intoId }`), `POST /admin/ingredients/:id/review` | §7.2. |
| `POST /admin/ingredients/import` | §7.4. Simule par défaut ; écrit avec `{ confirm: true }`. |

### 8.4 Listes

- `GET /referentials/units` et `GET /referentials/aisles` (nouvelles).
- `GET /referentials/dish-categories` renvoie les 7 types.
- `GET` et `PUT /admin/settings/aisles` fonctionnent comme les modes de réchauffage.

### 8.5 Contrôles des entrées

Les règles s'appliquent dans l'API ; les écrans les reprennent seulement pour afficher des messages clairs.

- Textes : caractères de contrôle retirés. Nom d'ingrédient de 1 à 120 caractères ; au plus 20 autres noms de 120 caractères.
- Nombres : quantité finie, au plus 100 000, 3 décimales ; mois au congélateur de 1 à 24 ; mois de saison de 1 à 12, sans doublon.
- Codes : allergènes parmi les 14, sans doublon ; régimes parmi les régimes calculés ; rayon parmi la liste en vigueur ; unité parmi les 14.
- Plafonds du lot 2 inchangés.

### 8.6 Nouveaux codes

| Code | Où |
|---|---|
| `INGREDIENT_NOT_LINKED`, `INGREDIENT_INCOMPLETE`, `DECLARED_DIET_NOT_ALLOWED` | Problèmes du contrôle « Prête » |
| `NO_COMMON_SEASON`, `FRIDGE_LONG` | Alertes |
| `DUPLICATE_INGREDIENT_LINE` | 422 |
| `RECIPE_CONFLICT` (et `INGREDIENT_ALREADY_LISTED`, qui existe déjà) | 409 |
| `INGREDIENT_CAP_REACHED` | 429 |

## 9. Reprise des plats existants

Un script séparé de la migration, `npm run db:recipes:reprise`. Il affiche la base visée, simule par défaut, et n'écrit qu'avec `--yes`. Il est rejouable : une ligne déjà reliée est ignorée. Il se lance une fois la liste commune importée et relue sur la base visée.

Le script traite le contenu actuel de chaque plat : plats des chefs, recettes LAB'S FOOD et propositions. Les versions ne sont pas touchées.

| Avant | Après |
|---|---|
| Ligne non reliée | Reliée si son nom, sous forme normalisée (accents, casse, espaces, pluriel simple en « s » ou « x »), égale le nom ou un autre nom d'un ingrédient commun actif. Pas de rapprochement approximatif. Sinon : « à vérifier », avec `rawText`. |
| Unité en texte | Convertie : `g`, `gr`, `grammes` → `g` ; `kg` ; `ml` ; `cl` ; `l`, `litre` → `l` ; `c. à café`, `cac` → `tsp` ; `c. à soupe`, `cas` → `tbsp` ; `pièce`, `pc`, `u`, vide → `piece` ; `gousse` → `clove` ; `botte` → `bunch` ; `tranche` → `slice` ; `feuille` → `leaf` ; `pincée` → `pinch` ; `selon le goût`, `au goût` → `to_taste`. Une autre unité rend la ligne « à vérifier ». |
| `storage` | `freezable` vrai si la méthode est le congélateur ; sinon non renseigné, et le contrôle le signalera. |
| `allergens` déclarés | Copiés dans `added_allergens`, pour que rien ne disparaisse. Puis les allergènes sont recalculés. |
| Plat vérifié dont le calcul trouve un allergène nouveau | Vérification effacée, `recipe_allergens_changed`. |
| Statut, publication, versions, prestations | Inchangés. |

Chaque chef concerné reçoit une notification `recipes_migrated` et un e-mail, avec le nombre de lignes à vérifier. Le rapport donne les chiffres par chef et les noms non reliés, classés par fréquence, pour compléter la liste commune avant le vrai passage.

## 10. Écrans

### 10.1 Espace chef (`batchcooking-web`, formulaire du lot 2)

- **Ligne d'ingrédient :**
  - recherche dans la liste commune et ses ingrédients ;
  - « Créer « … » », qui ouvre une fenêtre sans quitter la recette ;
  - unité en liste, « facultatif », précision, préparation, groupe ;
  - « caché au client », prérempli pour un ingrédient de base ;
  - texte d'origine pour une ligne « à vérifier ».
- **Allergènes :**
  - les allergènes calculés, avec leurs ingrédients, et la mention « si utilisé » ;
  - les 14 allergènes à ajouter : un allergène calculé ne peut pas être décoché ;
  - « Autre », et le bouton de confirmation existant.
- **Conservation et réchauffage :** congelable, mois, décongélation, consignes.
- **Panneau « Ce qu'il manque » :** les nouveaux codes, chacun avec un lien vers son champ.
- **Historique :** versions, contenu, restauration.
- **Conflit :** un bandeau « Modifiée ailleurs : recharger » sur `409`.
- **Pages et cloche :** une page « Mes ingrédients », et les libellés des nouveaux types dans la cloche.

### 10.2 Console (`admin-dashboard`, sur le lot 2)

- **Ingrédients :**
  - nouveaux champs et filtres (statut, rayon, à compléter, relu) ;
  - impact avant d'enregistrer ;
  - file « À valider » ;
  - import CSV, simulation puis confirmation ;
  - suivi de la relecture.
- **Paramètres :** liste des rayons.
- **Recettes LAB'S FOOD :** nouvelle forme des lignes et allergènes calculés.

## 11. Tests

- **Calculs** :
  - allergènes : de base, cachés, facultatifs seuls ou aussi obligatoires, ajoutés, ingrédient « à compléter » ;
  - régimes : `gluten-free` retiré par un gluten ajouté ;
  - saisons : facultatifs ignorés, aucun mois commun ;
  - contrôle « Prête », point par point ;
  - arrondis de chaque famille d'unités ;
  - R10 ;
  - revérification du §6.5 ;
  - conversion des unités ;
  - lecture du CSV.
- **Services** :
  - report du §7.3 ;
  - création, validation et fusion d'un ingrédient privé ;
  - accès aux ingrédients ;
  - `409 RECIPE_CONFLICT` ;
  - restauration ;
  - reprise : simulation sans écriture, et second passage qui ne change rien.
- **Entrées invalides** : pour chaque route, champs inconnus, types faux, bornes, identifiants étrangers, doublons, plafonds. Les mêmes envois sont rejoués contre l'API lancée en local (base Docker, avec accord).
- **Écrans** : lint, types et build des deux fronts, puis un parcours dans l'application lancée.

Les cinq situations les plus risquées pour un utilisateur, chacune vérifiée par un test :

1. Deux onglets ouverts sur la même recette : l'enregistrement fait avec une `lockVersion` périmée répond `409` et n'écrit rien.
2. LAB'S FOOD modifie un ingrédient pendant que le chef modifie sa recette : l'enregistrement suivant du chef répond `409` ; après rechargement, les allergènes sont recalculés et la vérification est effacée.
3. La reprise ne fait jamais disparaître un allergène : pour chaque plat, les allergènes après la reprise contiennent ceux d'avant.
4. L'ingrédient privé d'un autre chef est refusé à l'enregistrement et absent de la recherche.
5. Une version dont un ingrédient a été fusionné depuis est restaurée : la ligne est repointée et les allergènes sont recalculés.

## 12. Livraison

- **Branches :**
  - `feat/recettes-socle` à partir de `develop` dans l'API et l'espace chef ;
  - pour la console, à partir de `develop` si la PR du lot 2 est fusionnée, sinon à partir de `origin/feat/recettes-lot-2`, et notre PR passe après la leur.
- **Fusion :** les trois PR sont fusionnées ensemble. Allergènes en lecture seule, unités en liste et `rawText` cassent l'ancien formulaire, comme les étapes typées l'ont fait au lot 2.
- **Bases de données :** aucune migration n'est appliquée et aucun script n'écrit sur une base sans accord explicite. Les tests contre l'API lancée utilisent la base Docker locale.
- **Ordre de mise en service :**
  1. migration ;
  2. import et relecture de la liste de départ. Les ingrédients du lot 2 n'ont pas encore de `normalized_name` (la reprise le remplit à l'étape 4) : l'API les retrouve par leur nom, normalisé par elle (accents, casse, `œ`/`æ`, espaces), à l'import comme au contrôle d'unicité des noms. Une ligne du fichier qui porte le nom d'un ingrédient du lot 2 met donc à jour cet ingrédient, au lieu d'en créer un second, et lui donne son `normalized_name` ; la reprise ne voit qu'un ingrédient par nom. Toute autre modification d'un ingrédient du lot 2 dans la console remplit aussi son `normalized_name`, si aucun autre ingrédient ne le porte ;
  3. simulation de la reprise, puis complément de la liste avec les noms non reliés ;
  4. reprise, terminée avec 0 plat ignoré et 0 en échec avant que le nouvel espace chef soit servi (R33) : un formulaire ne doit jamais supprimer une ligne que le chef n'a pas touchée. L'API sert déjà les lignes comme les règles les lisent (unité hors des 14 non reconnue ou quantité illisible : « à vérifier », avec `rawText`) ;
  5. message aux chefs : leurs recettes incomplètes ne sont plus « Prête », comme pour LF-0266.

## 13. À valider avec Daniel

Ces points changent le comportement du lot 2 :

1. Allergènes calculés : `allergens` et `allergensNone` passent en lecture seule dans l'API.
2. Chaque ligne doit être reliée à la liste commune pour être « Prête ».
3. Contrôle « Prête » plus complet (§6.4), et photo exigée pour publier, alors que BLK-32 la laissait non bloquante au départ.
4. Unités en liste fixe, au lieu du texte libre.
5. Nom et rayon d'une ligne reliée recopiés par l'API depuis la liste commune.
6. `catalog_ingredients` : index unique sur `name` remplacé par deux index partiels, nouvelles colonnes, ingrédients privés.
7. Types de plat : 4 → 7.
8. `lockVersion` facultatif sur l'enregistrement d'un plat.
9. Saisons : lignes facultatives ignorées.
10. Console : notre travail part de `feat/recettes-lot-2`, dont la PR doit passer en premier.

Lien avec le lot 3 (« Menu figé et conservation ») : le figement des allergènes au moment de la validation du menu (LF-0268) lira `allergens`, qui garde son sens. Le socle ne fige rien de plus.

## 14. Écarts avec la V4 et trous du document

Écarts décidés :

1. Une version est créée automatiquement quand la recette redevient « Prête », plutôt que par un bouton « Enregistrer la version » (choix du lot 2).
2. Matériel en texte libre, sans niveaux ni remplacement (choix du lot 2).
3. Plafonds de 60 ingrédients, 40 étapes et 2 000 caractères malgré « aucune limite » (choix du lot 2).
4. Une seule photo principale (choix du lot 2).
5. Un allergène ajouté par le chef s'affiche comme un allergène calculé, sans la mention « traces possibles » du §4.9.
6. « Restaurer » repasse par les contrôles au lieu de créer immédiatement une version identique.
7. Au moins un mode de réchauffage exigé pour être « Prête ».
8. Origine culinaire facultative, et non contrôlée au §4.11.
9. Seuil d'alerte de conservation fixé à 4 jours dans le code, pas réglable.
10. Une ligne reliée à un ingrédient « à compléter » apporte ses allergènes (§6.1), au lieu de « n'apporter rien » : seul l'état devient incomplet, comme pour un code d'allergène inconnu.

Trous du document à faire compléter par LAB'S FOOD :

1. Sections absentes : 2.1, **4.4 (créer ses ingrédients, citée trois fois)**, 8.7, 9.4 et 16. « Annexe B » renvoie à l'annexe A.
2. Le tableau du §4.3 dit l'ingrédient « rédigé par le batch cooker », contrairement aux §4.1 et §4.10. Tranché : liste commune.
3. La « précision d'achat » n'est définie nulle part. Tranché au §4.
4. L'origine culinaire est à la fois obligatoire (tableau du §4.2) et facultative (§4.1). Tranché : facultative.
5. Les arrondis « faciles à acheter » de la liste de courses (§10.2, étape 4) ne sont pas définis (sous-projet 7).
6. §3.1, étape 11 (justificatif et prélèvement des courses, litige) contredit le §1.3, qui l'exclut du périmètre.
7. §10.8, étape 5 : « envoyer une alerte 24 h avant de faire les courses » ne dit ni à qui, ni pourquoi, ni ce qui se passe sans cette alerte.
8. Point à valider 4 (un enfant compte pour une portion entière) contre BLK-27 (une demi-portion, décidé le 02/11).
