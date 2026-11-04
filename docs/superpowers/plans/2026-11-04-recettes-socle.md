# Module Recettes — socle recette sur le lot 2 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter au lot 2 ce que la V4 demande : liste commune avec allergènes et rayons, ingrédients des chefs, allergènes calculés, contrôle « Prête » complet, report des modifications, historique, import, reprise des plats.

**Architecture :** la recette reste dans `meals` (lignes en JSON) et ses versions dans `meal_recipe_versions`. Chaque ligne reliée reçoit de l'API une copie de son ingrédient (nom, rayon, allergènes, « à compléter »), si bien que les calculs (`allergens.rules.ts`, `classification.rules.ts`, `readiness`) restent des fonctions pures sur la ligne. Un seul helper avec base (`ingredients/composition.ts`) recopie ces données ; l'enregistrement, la restauration, le report et la reprise l'appellent tous.

**Tech Stack :** NestJS 11, Prisma 7, PostgreSQL, Jest (API) ; Next.js, react-query (espace chef, console).

**Spec :** `LF-BackEnd/docs/superpowers/specs/2026-11-04-recettes-socle-design.md`

## Global Constraints

- Branche `feat/recettes-socle` à partir de `develop` dans `LF-BackEnd` (déjà créée) et `batchcooking-web`. Pour `admin-dashboard`, à partir de `develop` si la PR du lot 2 y est fusionnée, sinon à partir de `origin/feat/recettes-lot-2`.
- Aucune migration appliquée et aucun script qui écrit sur une base sans accord explicite. `prisma generate` et `prisma validate` sont autorisés.
- Un commit par tâche, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ni push ni PR sans demande.
- Ne jamais commiter : `graphify-out/`, `supprimer-comptes-clerks.ps1`, les changements de l'utilisateur sur `batchcooking-web/AGENTS.md` ni ses `docs/FLOW-0*.md` non suivis.
- Style de l'API : commentaires et messages d'erreur en anglais, renvois « Recettes §x » comme le code du lot 2. Textes des écrans en français.
- Unités (codes, libellé, pluriel) : `g` g ; `kg` kg ; `ml` ml ; `cl` cl ; `l` l ; `tsp` c. à café ; `tbsp` c. à soupe ; `piece` pièce/pièces ; `clove` gousse/gousses ; `bunch` botte/bottes ; `slice` tranche/tranches ; `leaf` feuille/feuilles ; `pinch` pincée/pincées ; `to_taste` selon le goût.
- Rayons par défaut, dans cet ordre : `fruits-legumes`, `boulangerie`, `boucherie`, `poissonnerie`, `cremerie`, `fromages`, `epicerie-salee`, `conserves`, `epices`, `epicerie-sucree`, `boissons`, `non-alimentaire`, `surgeles`, avec les libellés du §5.4 de la spec.
- Types de plat : `main` Plat complet, `starter` Entrée, `soup` Soupe, `side` Accompagnement, `dessert` Dessert, `breakfast` Petit-déjeuner ou goûter, `sauce` Sauce ou base.
- Bornes : quantité finie, > 0, ≤ 100 000, 3 décimales ; `precision` 60 ; `preparation` 120 ; `group` 60 ; `rawText` 200 ; `freezerMonths` 1 à 24 ; `thawing` 300 ; nom d'ingrédient 1 à 120 ; au plus 20 autres noms de 120 caractères ; au plus 50 ingrédients privés par chef sur 24 h glissantes ; CSV ≤ 2 Mo et ≤ 2 000 lignes. Plafonds du lot 2 inchangés (60, 40, 2 000).
- `FRIDGE_ALERT_DAYS = 4`.
- Notifications : `recipe_allergens_changed` (sujet `meal`), `ingredient_validated` et `ingredient_merged` (sujet `catalog_ingredient`), `recipes_migrated` (sujet `chef_profile`). Modèles Brevo : `BREVO_TPL_RECIPE_ALLERGENS_CHANGED`, `BREVO_TPL_RECIPES_MIGRATED`.
- Codes d'erreur ajoutés : `RECIPE_CONFLICT` (409, avec `lockVersion`), `DUPLICATE_INGREDIENT_LINE` (422, avec `lines`), `INGREDIENT_NOT_LINKED` (422 à la confirmation, et problème du contrôle), `INGREDIENT_INCOMPLETE`, `DECLARED_DIET_NOT_ALLOWED` (problèmes), `NO_COMMON_SEASON`, `FRIDGE_LONG` (alertes), `INGREDIENT_CAP_REACHED` (429). `INGREDIENT_ALREADY_LISTED` (409) existe déjà : on lui ajoute l'ingrédient trouvé.
- Commandes : API dans `LF-BackEnd/apps` (`npm test -- <chemin>`, `npm run lint`, `npm run build`) ; fronts : `npm run typecheck`, `npm run lint`, `npm run build`. Les fronts n'ont pas de tests automatiques.

## Review Focus

1. **Deux onglets sur la même recette** : un enregistrement avec une `lockVersion` périmée répond `409 RECIPE_CONFLICT` et n'écrit rien. Test : tâche 9.
2. **LAB'S FOOD modifie un ingrédient pendant que le chef écrit** : le report augmente `lockVersion` ; l'enregistrement suivant du chef répond `409` ; le plat relu a ses allergènes recalculés et sa vérification effacée. Tests : tâches 14 et 9.
3. **La reprise ne retire jamais un allergène** : pour chaque plat, les allergènes après contiennent ceux d'avant. Test : tâche 19.
4. **Ingrédient privé d'un autre chef** : refusé à l'enregistrement et absent de la recherche. Tests : tâches 7 et 15.
5. **Restaurer une version dont un ingrédient a été fusionné** : la ligne est repointée et les allergènes recalculés. Test : tâche 11.

---

## Partie A — API (`LF-BackEnd/apps`)

### Task 1 : commiter la spec et le plan

- [ ] `git add docs/superpowers/specs/2026-11-04-recettes-socle-design.md docs/superpowers/plans/2026-11-04-recettes-socle.md`, puis commit `docs(recettes): socle recette on top of lot 2, spec and plan`.

### Task 2 : schéma et migration

**Files :** Modify `prisma/schema.prisma` (`CatalogIngredient`, `Meal`, relations sur `ChefProfile` et `User`) ; Create `prisma/migrations/20261105100000_recipes_socle/migration.sql`.

**Produces :** `CatalogIngredient.{normalizedName: String?, aisle: String?, allergens: String[], allergensNone: Boolean, isBasic: Boolean, chefProfileId: String?, status: String, mergedIntoId: String?, createdByUserId: String?, reviewedAt: DateTime?, reviewedByUserId: String?}` ; `Meal.{addedAllergens: String[], conditionalAllergens: String[], lockVersion: Int}`.

- [ ] Écrire la migration, rejouable comme celles du lot 2 (`IF NOT EXISTS`, blocs `DO $$ … duplicate_object`) :
  - `catalog_ingredients` : `normalized_name VARCHAR(120)` nullable (rempli par l'API et par la reprise, pas en SQL faute d'`unaccent`) ; `aisle VARCHAR(40)` ; `allergens TEXT[] NOT NULL DEFAULT '{}'` ; `allergens_none BOOLEAN NOT NULL DEFAULT false` ; `is_basic BOOLEAN NOT NULL DEFAULT false` ; `chef_profile_id UUID` (FK `chef_profiles`, CASCADE) ; `status VARCHAR(16) NOT NULL DEFAULT 'active'`, avec CHECK sur `active|pending|inactive|merged` ; `merged_into_id UUID` (FK sur elle-même, SET NULL) ; `created_by_user_id`, `reviewed_by_user_id` (FK `users`, SET NULL) ; `reviewed_at TIMESTAMPTZ(6)`.
  - CHECK `NOT (allergens_none AND cardinality(allergens) > 0)`, et CHECK `allergens <@ ARRAY[...]` avec les 14 codes.
  - `DROP INDEX IF EXISTS uq_catalog_ingredients_name` ; index uniques partiels `uq_catalog_ingredients_common_name (normalized_name) WHERE chef_profile_id IS NULL AND normalized_name IS NOT NULL` et `uq_catalog_ingredients_private_name (chef_profile_id, normalized_name) WHERE status = 'pending'` ; index `ix_catalog_ingredients_chef_profile_id` et `ix_catalog_ingredients_status`.
  - `meals` : `added_allergens TEXT[] NOT NULL DEFAULT '{}'`, `conditional_allergens TEXT[] NOT NULL DEFAULT '{}'`, `lock_version INTEGER NOT NULL DEFAULT 0`.
- [ ] Reporter le tout dans `schema.prisma` : `name` perd `@unique`, et chaque nouvelle colonne a un commentaire `///` comme ses voisines.
- [ ] Lancer `npx prisma validate` puis `npx prisma generate` : OK. Lancer `npx tsc --noEmit -p tsconfig.json` et corriger les usages de l'ancien index unique (`assertNameFree` reste en place jusqu'à la tâche 13).
- [ ] Commit `feat(recettes): schema for the common list, computed allergens and lock version`.

### Task 3 : unités et arrondis

**Files :** Create `src/modules/dishes/domain/units.rules.ts` et `.spec.ts` ; Modify `src/modules/dishes/domain/recipes.rules.ts` et `.spec.ts`.

**Produces :**
- `UNITS: readonly { code; label; plural }[]` et `UNIT_CODES` ;
- `roundForDisplay(qty: number, unit: string): number` ;
- `displayQuantity(qty: number | null, unit: string): string` ;
- `unitFromText(text: string): string | null`.

- [ ] Tests de `roundForDisplay` :
  - `('piece', 2.1)` → 3 ; `('clove', 0.4)` → 1 ;
  - `('g', 7.46)` → 7.5 ; `('g', 46.4)` → 46 ; `('g', 132.4)` → 130 ; `('g', 133)` → 135 ;
  - `('kg', 1.255)` → 1.26 ; `('tsp', 0.2)` → 0.5 ; `('tsp', 1.3)` → 1.5 ; `('tbsp', 1.2)` → 1 ;
  - une unité inconnue (`'gousse'`, 1.234) → 1.23.
- [ ] Tests de `displayQuantity` : `(1.5, 'kg')` → `'1,5 kg'` ; `(2, 'clove')` → `'2 gousses'` ; `(1, 'clove')` → `'1 gousse'` ; `(null, 'to_taste')` → `'selon le goût'` ; `(1.234, 'gousse')` → `'1,23 gousse'`.
- [ ] Tests de `unitFromText`, accents, casse et points ignorés :
  - `'gr'` → `g` ; `'Litre'` → `l` ;
  - `'c. à soupe'`, `'cas'` → `tbsp` ; `'c. à café'`, `'cac'` → `tsp` ;
  - `''`, `'pièce'`, `'u'` → `piece` ; `'gousses'` → `clove` ; `'au goût'` → `to_taste` ;
  - un code déjà valide reste lui-même ; `'poignée'` → `null`.
- [ ] Vérifier que les tests échouent, puis implémenter. Arrondis à `Number.EPSILON` près, comme `round` dans `recipes.rules.ts`.
- [ ] Dans `recipes.rules.ts` :
  - `roundLines` appelle `roundForDisplay` ;
  - `toLine` garde une ligne `to_taste` sans quantité, lue avec `qty: 0` ;
  - mettre à jour les tests existants qui s'appuyaient sur l'ancien arrondi.
- [ ] Lancer `npm test -- src/modules/dishes/domain` : PASS.
- [ ] Commit `feat(recettes): fixed units and per-unit display rounding`.

### Task 4 : règles des ingrédients et des lignes

**Files :** Create `src/modules/ingredients/domain/ingredient.rules.ts`, `src/modules/dishes/domain/recipe-lines.rules.ts`, avec leurs tests ; Modify `recipes.rules.ts` (retirer `ingredientsChanged`).

**Produces :**
- `normalizeName(name): string` ; `matchKey(name): string` ; `withImpliedDiets(diets: string[]): string[]` ; `isEntryComplete(e: { aisle: string | null; allergens: string[]; allergensNone: boolean }): boolean` ;
- `interface LineInput` : les champs du §5.2 de la spec, sans `allergens` ni `incomplete` ;
- `interface StoredLine extends LineInput` : avec `allergens: string[]` et `incomplete: boolean`, chaque champ facultatif rendu explicite (`null` ou `false`) ;
- `readLines(raw: unknown): StoredLine[]` ; `toLineInput(raw: unknown): LineInput` (ligne ancienne → unité convertie par `unitFromText`, sinon `toVerify: true`, `unit: null`, `rawText` = `"<qty> <unit> <name>"`) ;
- `lineInputProblems(lines: LineInput[]): { field: string; message: string }[]` ;
- `duplicateLines(lines: LineInput[]): number[][]` ;
- `compositionChanged(before: unknown, after: unknown): boolean` ;
- `interface SafetySnapshot { ingredients: unknown; addedAllergens: string[]; customAllergens: string[]; allergens: string[]; conditionalAllergens: string[] }` et `reverifyNeeded(before: SafetySnapshot, after: SafetySnapshot): boolean`.

- [ ] Tests :
  - `normalizeName(' Œufs  de  Caille ')` → `'oeufs de caille'` ;
  - `matchKey('Tomates')` égale `matchKey('tomate')` ; `matchKey('Riz')` → `'riz'` (les mots de 3 lettres ou moins gardent leur fin) ;
  - `withImpliedDiets(['vegan'])` → `['vegetarian', 'vegan', 'no-pork', 'pescetarian']`, dans l'ordre de `COMPUTED_DIET_CODES` ;
  - `isEntryComplete` : faux sans rayon, faux sans allergènes ni « aucun », vrai avec `allergensNone`.
- [ ] Tests de `lineInputProblems` :
  - `qty` nulle avec `unit: 'g'` → problème sur `recipe.ingredients[0].qty` ;
  - `qty: 2` avec `to_taste` → problème ;
  - `unit: null` sans `toVerify` → problème ;
  - une ligne `toVerify` sans quantité ni unité → aucun problème.
- [ ] Tests de `duplicateLines` :
  - même groupe, même ingrédient, précisions « Bio » et « bio » → `[[0, 1]]` ;
  - groupes différents → `[]` ;
  - lignes non reliées → ignorées.
- [ ] Tests de `compositionChanged` :
  - même liste dans un autre ordre, ou quantités changées → faux ;
  - ligne ajoutée, ingrédient changé, `optional` basculé, nom changé sur une ligne non reliée → vrai.
- [ ] Tests de `reverifyNeeded` : vrai si `compositionChanged`, si `addedAllergens` ou `customAllergens` changent (comparés comme des ensembles), ou si `allergens` ou `conditionalAllergens` changent ; faux si seule la précision change.
- [ ] Vérifier l'échec, implémenter, vérifier le succès. Remplacer les usages de `ingredientsChanged` par `compositionChanged`.
- [ ] Commit `feat(recettes): ingredient and recipe line rules`.

### Task 5 : allergènes calculés, régimes et saisons

**Files :** Create `src/modules/dishes/domain/allergens.rules.ts` et `.spec.ts` ; Modify `classification.rules.ts` et `.spec.ts`.

**Produces :**
- `interface AllergenState { allergens: string[]; conditionalAllergens: string[]; allergensNone: boolean; sources: Record<string, string[]>; complete: boolean }` ;
- `allergenStateOf(lines: StoredLine[], added: string[], custom: string[]): AllergenState` ;
- `sameAllergenState(a, b): boolean` ;
- `classify(ingredients, catalog, allergens: string[] = [])`.

- [ ] Tests de `allergenStateOf`, avec les codes rangés dans l'ordre de `ALLERGEN_CODES` :
  - Beurre `['milk']` + Farine `['gluten']` → `allergens ['gluten', 'milk']`, `conditional []`, `sources { gluten: ['Farine'], milk: ['Beurre'] }`, `complete: true` ;
  - Crème facultative `['milk']` seule → `allergens ['milk']`, `conditional ['milk']` ;
  - la même, plus Beurre obligatoire → `conditional []` ;
  - Crème facultative avec `added ['milk']` → `conditional []` ;
  - lignes sans allergène, ni `added` ni `custom` → `allergensNone: true` ;
  - les mêmes avec `custom ['sarrasin']` → `allergensNone: false` ;
  - une ligne non reliée, ou `incomplete` → `complete: false` et `allergensNone: false`, les autres allergènes toujours comptés ;
  - aucune ligne → `complete: false`.
- [ ] Tests de `classify` :
  - Tomate `[6, 7, 8, 9]` + Basilic facultatif `[5, 6]` → `seasonMonths [6, 7, 8, 9]` ;
  - entrées toutes `gluten-free` avec `allergens ['gluten']` → `gluten-free` absent ;
  - aucun mois commun → `seasonMonths []`.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit `feat(recettes): allergens computed from the ingredients`.

### Task 6 : contrôle « Prête », types de plat et erreurs

**Files :** Modify `src/modules/dishes/domain/dishes.rules.ts`, `.spec.ts`, `content.errors.ts`, `content.errors.spec.ts`.

**Produces :**
- `DISH_CATEGORIES` (7 types) ; `FRIDGE_ALERT_DAYS` ;
- `ReadinessDish` gagne `declaredDiets: string[]` et `classification: unknown` ;
- `PublishProblem.code` gagne `INGREDIENT_NOT_LINKED | INGREDIENT_INCOMPLETE | DECLARED_DIET_NOT_ALLOWED | NO_COMMON_SEASON | FRIDGE_LONG` ;
- erreurs `recipeConflict(lockVersion: number)` (409), `duplicateIngredientLine(lines: number[][])` (422), `ingredientNotLinked(lines: number[])` (422), `ingredientCapReached()` (429).

- [ ] Tests `readiness`, un par point du §6.4 de la spec :
  - ligne sans `catalogIngredientId` → `INGREDIENT_NOT_LINKED` sur `recipe.ingredients[i]` ;
  - ligne `incomplete` → `INGREDIENT_INCOMPLETE` ;
  - `storage` sans `freezable` → `VALIDATION_FAILED` sur `recipe.storage.freezable` ;
  - `freezable: true` sans `freezerMonths` ni `thawing` → deux problèmes ;
  - `reheating.note` vide → `recipe.reheating.note` ;
  - `declaredDiets ['halal']` avec une classification sans `no-pork`, ou nulle → `DECLARED_DIET_NOT_ALLOWED` sur `declaredDiets`.
- [ ] Tests des points pour publier (`toPublish`) :
  - toutes les lignes `hiddenFromClient` → problème sur `recipe.ingredients` ;
  - `imageUrl` nul → `PHOTO_MISSING`, qui passe des alertes aux points pour publier.
- [ ] Tests des alertes : `NO_COMMON_SEASON` (classification calculée avec `seasonMonths []` et pas de `seasonsOverride`) ; `FRIDGE_LONG` (`method: 'fridge'`, `days: 5`).
- [ ] `ALLERGENS_REQUIRED` disparaît de `readiness` et de `publishProblems`, car les allergènes sont calculés. Adapter les tests existants et `readyDishRow` dans `dishes.test-helpers.ts` (lignes reliées, rayon, `allergens: []`, `freezable: false`, consigne de réchauffage).
- [ ] Tests des nouvelles erreurs : code, statut et détails.
- [ ] Vérifier l'échec, implémenter, puis lancer `npm test -- src/modules/dishes` : PASS.
- [ ] Commit `feat(recettes): full §4.11 check, seven dish types`.

### Task 7 : recopie des ingrédients sur les lignes

**Files :** Create `src/modules/ingredients/composition.ts` et `.spec.ts` ; Modify `ingredients.service.ts` (`classificationOf` y devient un appel à `compositionOf`).

**Produces :**
- `interface EntryRow` : `id`, `name`, `aisle`, `allergens`, `allergensNone`, `isBasic`, `diets`, `seasonMonths`, `status`, `chefProfileId`, `mergedIntoId` ;
- `entriesFor(db, ids: string[]): Promise<Map<string, EntryRow>>` : clé = l'identifiant demandé, valeur = l'entrée qui le remplace si elle est `merged` (un seul saut) ;
- `stampLines(lines: LineInput[], entries: Map<string, EntryRow>): StoredLine[]` (pure) ;
- `compositionOf(db, lines: LineInput[], extras: { addedAllergens: string[]; customAllergens: string[] }): Promise<{ ingredients: StoredLine[]; state: AllergenState; classification: Classification | null }>` ;
- `assertIngredientAccess(db, lines: LineInput[], scope: { chefProfileId: string | null; previousIds: Set<string> }): Promise<void>`.

- [ ] Tests de `stampLines` :
  - une ligne reliée prend le nom, le rayon et les allergènes de l'entrée, avec `incomplete = !isEntryComplete(entrée)` ;
  - `hiddenFromClient` absent prend `isBasic` ;
  - une ligne reliée à une entrée fusionnée prend l'identifiant de la cible ;
  - un identifiant inconnu donne une ligne non reliée, `toVerify: true`, `rawText` rempli ;
  - une ligne non reliée garde son nom et a `allergens []`.
- [ ] Tests de `assertIngredientAccess` (point 4 du Review Focus) :
  - entrée commune `active` → OK ;
  - privée `pending` du même chef → OK ;
  - privée d'un autre chef → `422 VALIDATION_FAILED` qui nomme la ligne ;
  - privée avec `chefProfileId: null` dans le scope (recette LAB'S FOOD) → 422 ;
  - commune `inactive` → 422, sauf si son identifiant est dans `previousIds` ;
  - `merged` → 422.
- [ ] Vérifier l'échec, implémenter (une seule requête `findMany` par appel, puis une autre pour les cibles de fusion), vérifier le succès.
- [ ] Commit `feat(recettes): stamp lines with their common-list entry`.

### Task 8 : DTO et vues des plats

**Files :** Modify `src/modules/dishes/dto/dish.dto.ts`, `dishes.views.ts`, `swagger-examples.ts` ; Create `src/modules/dishes/dto/dish.dto.spec.ts`.

**Produces :**
- `IngredientDto` : `qty` et `unit` nullables, `unit` dans `UNIT_CODES`, `aisle` facultatif, plus `optional`, `precision`, `preparation`, `group`, `hiddenFromClient`, `rawText` ;
- `StorageDto` : `freezable`, `freezerMonths`, `thawing` ;
- `CreateDishDto` : sans `allergens` ni `allergensNone`, avec `addedAllergens` (codes des 14, sans doublon, au plus 14) ;
- `UpdateDishDto` : avec `lockVersion?: number` (entier ≥ 0) ;
- vues : `addedAllergens`, `conditionalAllergens`, `allergenSources`, `lockVersion` dans `toDishView` ; `conditionalAllergens` aussi dans `toPublicDish`.

- [ ] Tests des entrées invalides, avec `ApiValidationPipe` réglé comme dans `main.ts` (modèle : `common/validation.pipe.spec.ts`). Chacun répond 400 en nommant le champ :
  - `allergens` ou `allergensNone` envoyés ;
  - `unit: 'gousse'` ;
  - `qty: 0` ou `qty: 100001` ;
  - `precision` de 61 caractères ;
  - `addedAllergens ['dairy']` ;
  - `lockVersion: -1` ;
  - `freezerMonths: 25` ;
  - un champ inconnu sur une ligne.

  Un corps complet et valide passe.
- [ ] Les textes libres d'une ligne (`name`, `precision`, `preparation`, `group`, `rawText`) sont débarrassés de leurs espaces de bord et de leurs caractères de contrôle par un `@Transform`. Réutiliser le nettoyeur de `quotes/dto/quote.dto.ts` s'il convient ; sinon, en écrire un dans `common/dto/` et l'utiliser aussi à la tâche 13. Test : `"Bio\u0007 "` devient `"Bio"`.
- [ ] Vérifier l'échec, implémenter (DTO, vues, exemples Swagger), vérifier le succès.
- [ ] Commit `feat(recettes)!: dish wire format for computed allergens and fixed units`.

### Task 9 : enregistrement d'un plat

**Files :** Modify `src/modules/dishes/dishes.service.ts`, `dishes.service.spec.ts`, `dishes.test-helpers.ts`, `duplication.service.ts`, `suggestions.service.ts` et leurs tests.

**Consumes :** tâches 4 à 8.

- [ ] Tests dans `dishes.service.spec.ts` :
  - **conflit, point 1 du Review Focus** : `update` avec `lockVersion: 3` alors que la ligne lue a `lockVersion: 4` → `409 RECIPE_CONFLICT { lockVersion: 4 }`, sans `meal.update` ;
  - **conflit concurrent** : `meal.update` rejette P2025 et la relecture renvoie la ligne → `409` avec la valeur relue, et aucune version créée ;
  - **conflit après report, point 2 du Review Focus** : la ligne relue porte `lockVersion: 5` et une vérification effacée par le report ; l'envoi avec `lockVersion: 4` → `409 { lockVersion: 5 }`, et rien n'est écrit ;
  - **écriture** : un `update` qui envoie `recipe` écrit les lignes recopiées, `allergens`, `conditionalAllergens`, `allergensNone`, `classification`, et `lockVersion: { increment: 1 }` avec `where: { id, chefProfileId, lockVersion }` ;
  - **revérification** : `allergensVerifiedAt` est effacé quand `reverifyNeeded` est vrai (ligne ajoutée, `addedAllergens` changé), et gardé quand seule une quantité change ;
  - **doublon** : → `422 DUPLICATE_INGREDIENT_LINE { lines: [[0, 1]] }` ;
  - **ligne invalide** : `qty` nulle sur `g` → `422 VALIDATION_FAILED` ;
  - **plat publié** : un `update` qui rend la recette incomplète reste accepté ; le plat reste publié, sans nouvelle version ;
  - **confirmation** : `confirmAllergens` sur une ligne non reliée → `422 INGREDIENT_NOT_LINKED { lines: [1] }` ; sans ligne → `422 VALIDATION_FAILED` ;
  - **revue de modération** : un changement des allergènes calculés sur un plat publié déclenche `reviewFields`, comme un changement de pays.
- [ ] Implémenter :
  - calcul de la composition quand `recipe`, `addedAllergens` ou `customAllergens` sont envoyés ;
  - `assertIngredientAccess` avec `previousIds` = les identifiants des lignes actuelles ;
  - `touchesSafety` couvre `addedAllergens` et le changement de `AllergenState` ;
  - `assertPublishable` ne vérifie plus que le nom et les portions ;
  - `versionContentChanged` compare des lignes lues par `readLines` ;
  - P2025 avec une ligne relue → `recipeConflict`, sinon 404 comme aujourd'hui.
- [ ] Duplication et adoption d'une proposition : recopier `addedAllergens`, `conditionalAllergens`, et les lignes telles quelles. Ajouter un test à chacune.
- [ ] Lancer `npm test -- src/modules/dishes` : PASS.
- [ ] Commit `feat(recettes): save a dish with computed allergens and a lock version`.

### Task 10 : recettes LAB'S FOOD

**Files :** Modify `src/modules/catalog/dto/catalog-admin.dto.ts`, `.spec.ts`, `catalog.service.ts`, `catalog.service.spec.ts`.

- [ ] Tests :
  - `CreateMealDto` refuse `allergens` et `allergensNone`, et accepte `addedAllergens` ;
  - `createMeal` et `updateMeal` écrivent l'état calculé ;
  - `allergensVerifiedAt` vaut maintenant si `state.complete`, `null` sinon (l'enregistrement de l'admin reste la vérification) ;
  - un ingrédient privé dans une recette LAB'S FOOD → 422 ;
  - `flagCopies` est appelé quand les allergènes calculés changent.
- [ ] Vérifier l'échec, implémenter avec les helpers de la tâche 7 (`scope.chefProfileId: null`), vérifier le succès.
- [ ] Commit `feat(recettes): Lab's Food recipes compute their allergens too`.

### Task 11 : historique et restauration

**Files :** Create `src/modules/dishes/recipe-versions.service.ts` et `.spec.ts` ; Modify `me-content.controller.ts`, `dishes.module.ts`.

**Produces :**
- `RecipeVersionsService.list(clerkUserId, dishId): Promise<{ version: number; createdAt: Date; bookings: number; current: boolean }[]>` ;
- `get(clerkUserId, dishId, version): Promise<{ version; createdAt; portions; ingredients; steps; reheating; storage }>` ;
- `restore(clerkUserId, dishId, version, lockVersion?: number)` → vue du plat ;
- routes `GET /me/dishes/:id/versions`, `GET /me/dishes/:id/versions/:version` (`ParseIntPipe`), `POST /me/dishes/:id/versions/:version/restore`, avec un corps `{ lockVersion? }`.

- [ ] Tests :
  - `list` : de la plus récente à la plus ancienne, avec le nombre de `booking_meals` qui figent chaque version ;
  - `get` sur la version d'un autre chef → 404, comme `readableDish` ;
  - `restore` passe le contenu par `toLineInput` puis appelle `DishesService.update` avec `portions` et `recipe` ;
  - **fusion, point 5 du Review Focus** : une version dont une ligne relie une entrée `merged` est restaurée avec l'identifiant de la cible et les allergènes recalculés ;
  - une version ancienne avec `unit: 'gousse'` est restaurée en `clove`.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit `feat(recettes): recipe history and restore`.

### Task 12 : rayons, unités et listes

**Files :** Modify `src/modules/platform-settings/recipe-lists.ts`, `platform-settings.service.ts`, `platform-settings.controller.ts` et leurs tests, ainsi que `src/modules/chef-onboarding/referentials.controller.ts`.

**Produces :** `RECIPE_AISLES_KEY = 'recipe_aisles'`, `DEFAULT_RECIPE_AISLES`, `aislesInForce(db)`, `PlatformSettingsService.aisles()`, `setAisles(items, adminUserId, requestId?)`, et les routes `GET /referentials/aisles`, `GET`/`PUT /admin/settings/aisles` (corps `{ aisles: ListItemDto[] }`, 1 à 30), `GET /referentials/units`.

- [ ] Tests : liste par défaut dans l'ordre des Global Constraints ; `setAisles` refuse un code en double ; `GET /referentials/units` renvoie les 14 unités avec libellé et pluriel ; `GET /referentials/dish-categories` renvoie 7 types.
- [ ] Implémenter sur le modèle des modes de réchauffage, vérifier le succès.
- [ ] Commit `feat(recettes): editable aisles, units referential`.

### Task 13 : liste commune — champs et console

**Files :** Modify `src/modules/ingredients/dto/ingredient.dto.ts`, `ingredients.service.ts`, `ingredients.controller.ts`, `ingredients.service.spec.ts`, `ingredients.module.ts` (importe `DishesModule`), `src/modules/dishes/dishes.module.ts` (exporte `ChefContentService`). Pas de cycle : `DishesModule` n'importe pas `IngredientsModule`.

**Produces :**
- `CatalogIngredientDto` gagne `aisle`, `allergens`, `allergensNone`, `isBasic`. `UpdateCatalogIngredientDto` gagne aussi `status: 'active' | 'inactive'`.
- `ListCatalogIngredientsQueryDto` gagne `status`, `aisle`, `incomplete`, `reviewed`.
- `IngredientsService.search(term, chefProfileId: string | null)` : communs `active` et `pending` du chef, avec `private: boolean`.
- `review(id, adminUserId)`, et la route `POST /admin/ingredients/:id/review`.
- `alreadyListed(existing?: { id; name })` renvoie l'ingrédient trouvé.

- [ ] Tests :
  - `create` remplit `normalizedName`, ajoute les régimes impliqués et refuse un rayon hors liste (422) ;
  - `allergens` et `allergensNone` ensemble → 422 ;
  - un nom déjà pris parmi les communs, sous une autre casse ou d'autres accents → `409 INGREDIENT_ALREADY_LISTED` avec l'ingrédient ;
  - `list({ incomplete: true })` filtre `aisle IS NULL OR (allergens vide AND NOT allergensNone)` ;
  - `search` d'un chef n'inclut jamais un `pending` d'un autre chef, ni un `inactive` ou `merged` ;
  - le contrôleur résout le chef de l'appelant par `ChefContentService` ; un admin sans profil chef cherche avec `null`.
- [ ] Vérifier l'échec, implémenter (`assertNameFree` passe par `normalizedName`), vérifier le succès.
- [ ] Commit `feat(recettes): allergens, aisle and status on the common list`.

### Task 14 : report sur les recettes

**Files :** Create `src/modules/ingredients/ingredient-propagation.service.ts` et `.spec.ts` ; Modify `ingredients.service.ts` (le report remplace `reclassify`), `ingredients.module.ts` (importe `NotificationsModule`), `dishes.module.ts` (exporte `DishesMailer`), `dishes.mailer.ts`, `src/config/config.loader.ts`, `src/config/env.validation.ts`, `src/integrations/brevo.service.ts`, `../.env.example`.

**Produces :**
- `IngredientPropagationService.propagate(entryIds: string[], actorUserId: string, remap?: { from: string; to: string }): Promise<{ dishes: number; reverified: number; chefs: number }>` ;
- `IngredientsService.impact(id): Promise<{ dishes: number; chefs: number; verifiedDishes: number }>` et la route `GET /admin/ingredients/:id/impact` ;
- `DishesMailer.recipeAllergensChanged({ email, name?, dishCount })` et `recipesMigrated({ email, name?, dishCount, linesToVerify })`.

- [ ] Tests :
  - un plat vérifié dont l'ingrédient gagne `milk` → allergènes recalculés, vérification effacée, `lockVersion` +1, statut `published` inchangé, une notification `recipe_allergens_changed` au chef, un e-mail par chef même pour trois plats (point 2 du Review Focus, côté report) ;
  - un changement de rayon → lignes mises à jour, vérification gardée, aucune notification ;
  - un changement de nom → `versionPending: true`, vérification gardée ;
  - `remap` → lignes repointées et `versionPending: true` ;
  - une recette LAB'S FOOD est recalculée, sans notification ;
  - rejouer `propagate` ne change rien de plus ;
  - une trace d'audit `catalog_ingredient.propagated` avec les chiffres ;
  - l'e-mail est envoyé au mieux : un échec de Brevo n'annule rien.
- [ ] Vérifier l'échec. Implémenter avec une transaction par plat ; la recherche des plats reprend la requête `array_contains` de `reclassify`. Puis vérifier le succès.
- [ ] Commit `feat(recettes): carry ingredient changes into the recipes`.

### Task 15 : ingrédients des chefs, validation et fusion

**Files :** Create `src/modules/ingredients/chef-ingredients.service.ts`, `me-ingredients.controller.ts`, `dto/chef-ingredient.dto.ts`, avec leurs tests ; Modify `ingredients.service.ts`, `ingredients.controller.ts`.

**Produces :**
- `ChefIngredientsService.create(clerkUserId, dto)`, `listMine(clerkUserId)` (créés par lui, avec `status` et la cible d'une fusion), `update(clerkUserId, id, dto)` ;
- routes `POST`/`GET /me/ingredients`, `PATCH /me/ingredients/:id` (chef vérifié, comme les plats) ;
- `IngredientsService.validate(id, adminUserId)`, `merge(id, intoId, adminUserId)` ; routes `POST /admin/ingredients/:id/validate` et `/merge` (corps `{ intoId }`).

- [ ] Tests :
  - `create` sans allergènes ni « aucun » → 400 ;
  - un nom égal à un nom ou un autre nom commun, ou à l'un de ses ingrédients en attente → `409 INGREDIENT_ALREADY_LISTED` avec l'ingrédient ;
  - la 51ᵉ création sur 24 h → `429 INGREDIENT_CAP_REACHED` ;
  - le résultat est `pending` et porte son chef ;
  - `update` d'un ingrédient d'un autre chef → 404 ; d'un ingrédient validé → 422 ; un update valide appelle `propagate` ;
  - `validate` : `chefProfileId` nul, `active`, `reviewedAt`, notification `ingredient_validated` ; si un commun porte déjà le nom → 409 (il faut fusionner) ;
  - `merge` : cible commune `active` obligatoire (sinon 422), source `merged` avec `mergedIntoId`, `propagate` appelé avec `remap`, notification `ingredient_merged` ;
  - un ingrédient privé n'apparaît pas dans la recherche d'un autre chef (point 4 du Review Focus, côté recherche).
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit `feat(recettes): chefs add their own ingredients, Lab's Food validates or merges`.

### Task 16 : import CSV

**Files :** Create `src/modules/ingredients/domain/ingredient-csv.rules.ts`, `ingredient-import.service.ts`, avec leurs tests ; Modify `ingredients.controller.ts`.

**Produces :**
- `parseIngredientCsv(text: string, aisles: string[]): { rows: CatalogIngredientDto[]; errors: { line: number; message: string }[] }` ;
- `IngredientImportService.run(text, { confirm: boolean }, adminUserId): Promise<{ created; updated; unchanged; errors }>` ;
- route `POST /admin/ingredients/import`, corps `{ csv: string; confirm?: boolean }`, `csv` d'au plus 2 Mo.

- [ ] Tests :
  - colonnes `nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute`, avec `|` et `oui`/`non` ;
  - BOM et `\r\n` acceptés ;
  - en-tête manquant → une erreur ligne 1 ;
  - rayon inconnu, allergène inconnu, mois 13, `aucun_allergene: oui` avec des allergènes → une erreur par ligne ;
  - deux lignes au même nom normalisé → erreur sur la seconde ;
  - plus de 2 000 lignes → erreur ;
  - `run` sans `confirm` n'écrit rien ; avec des erreurs, n'écrit rien même avec `confirm` ;
  - une mise à jour d'une entrée existante appelle `propagate` ; rejouer le même fichier → tout `unchanged`.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit `feat(recettes): import the common list from CSV`.

### Task 17 : liste de départ

**Files :** Create `prisma/data/ingredients-v1.csv` et `src/modules/ingredients/domain/ingredients-v1.data.spec.ts`.

- [ ] Écrire environ 300 ingrédients courants de la cuisine du quotidien, au format de la tâche 16, sur les 13 rayons :
  - variétés distinctes (oignon jaune, oignon rouge) ;
  - allergènes conformes à l'annexe II du règlement 1169/2011 ;
  - régimes cohérents avec les allergènes ;
  - mois de saison pour les fruits et légumes frais ;
  - `base` pour sel, poivre, huiles, sucre, farine, eau ;
  - `doute` rempli dès qu'un point mérite la relecture de LAB'S FOOD.
- [ ] Test : le fichier se lit sans erreur, compte au moins 280 lignes, couvre les 13 rayons et les 14 allergènes, et chaque ligne `vegan` est aussi `vegetarian`.
- [ ] Commit `feat(recettes): starting list of common ingredients, to be reviewed`.

### Task 18 : liste de courses, fiche mission et PDF

**Files :** Modify `src/modules/shopping-lists/shopping-lists.service.ts`, `domain/shopping-list.rules.ts`, `src/modules/dishes/domain/recipes.rules.ts` (`groupByAisle`), `missions.service.ts`, `recipe-document.ts`, et leurs tests.

- [ ] Tests :
  - `groupByAisle(lines, order)` range les rayons dans l'ordre de `aislesInForce`, les rayons inconnus à la fin dans l'ordre d'apparition ;
  - une ligne `to_taste` reste dans la liste, sans quantité ;
  - le PDF affiche `displayQuantity` (« 2 gousses »), « (facultatif) » et la précision ;
  - la fiche mission arrondit par unité.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit `feat(recettes): shopping list, mission sheet and PDF read the new lines`.

### Task 19 : reprise des plats existants

**Files :** Create `src/modules/dishes/domain/reprise.rules.ts` et `.spec.ts`, `prisma/recipes-reprise.ts` ; Modify `package.json` (`db:recipes:reprise` et `db:recipes:reprise:dry`, sur le modèle de `db:backfill:clerk`).

**Produces :**
- `matchIndex(entries: { id; name; aliases }[]): Map<string, string>` (clé `matchKey`) ;
- `repriseLine(raw: unknown, index): LineInput` ;
- `repriseDish(meal: { ingredients; allergens; storage }, index): { lines: LineInput[]; addedAllergens: string[]; storage: unknown; linesToVerify: number }`.

- [ ] Tests :
  - « Tomates » relié à l'entrée « Tomate » ;
  - « tomates cerises » non relié s'il n'existe qu'une entrée « Tomate » (pas d'approximation) ;
  - une ligne déjà reliée reste telle quelle ;
  - unité `gousse` → `clove` ; `poignée` → `toVerify`, `unit: null`, `rawText` ;
  - `storage` congélateur → `freezable: true` ;
  - les allergènes déclarés passent dans `addedAllergens` ;
  - **point 3 du Review Focus** : pour un jeu de plats variés, `allergenStateOf(...)` après la reprise contient tous les allergènes d'avant.
- [ ] Script `prisma/recipes-reprise.ts` (modèle : `prisma/sync-clerk-to-db.ts`) :
  1. Il affiche l'hôte de la base et simule sans `--yes`.
  2. Il remplit `normalized_name` des entrées qui n'en ont pas.
  3. Pour chaque plat (chef, LAB'S FOOD, propositions), il applique `repriseDish` puis `compositionOf`, et écrit l'état avec `lockVersion` +1. Il ne touche ni aux versions ni aux statuts.
  4. Il efface la vérification et notifie si un allergène nouveau apparaît.
  5. Il envoie une notification `recipes_migrated` et un e-mail par chef.
  6. Il affiche le rapport : chiffres par chef, noms non reliés classés par fréquence.
  7. Rejoué, il ne change rien.
- [ ] Lancer `npm test -- src/modules/dishes/domain/reprise.rules.spec.ts` : PASS. Lancer `npx tsc --noEmit` : OK. Le script n'est **pas** lancé.
- [ ] Commit `feat(recettes): migration script for existing dishes`.

### Task 20 : clôture de l'API

- [ ] Lancer `npm test`, `npm run lint` et `npm run build` : tout passe. Relire la documentation Swagger des routes touchées (descriptions, exemples, codes d'erreur) et le `.env.example`.
- [ ] Commit `chore(recettes): api docs and examples` s'il reste des changements.

## Partie B — espace chef (`batchcooking-web`)

### Task 21 : branche, client d'API et vocabulaire

**Files :** Modify `lib/api/chef-catalog.ts`, `lib/api/referentials.ts`, `lib/recipe-fields.ts`, `lib/chef/recipes.ts` ; Create `lib/api/ingredients.ts`.

- [ ] Créer la branche :
  1. `git stash list` puis `git status`. Si `AGENTS.md` empêche `git checkout -b feat/recettes-socle develop`, s'arrêter et demander à l'utilisateur : ce fichier est à lui.
  2. Sinon, créer la branche ; ses changements la suivent sans être commités.
- [ ] Types et hooks :
  - `Ingredient` prend la forme du §5.2 de la spec ;
  - `Dish` gagne `addedAllergens`, `conditionalAllergens`, `allergenSources`, `lockVersion` ;
  - `DishInput` perd `allergens` et `allergensNone`, et gagne `addedAllergens` et `lockVersion` ;
  - `CatalogIngredient` gagne `aisle`, `allergens`, `allergensNone`, `isBasic`, `status`, `private` ;
  - hooks `useMyIngredients`, `useCreateIngredient`, `useUpdateIngredient`, `useUnits`, `useAisles`, `useDishVersions`, `useDishVersion`, `useRestoreVersion`.
- [ ] Vocabulaire :
  - `UNITS` devient la liste des codes avec libellés, et `lib/chef/recipes.ts` s'en sert ;
  - `AISLE_LABEL` vient de `useAisles`, avec la liste actuelle en repli ;
  - `displayQty` applique les règles par unité de la tâche 3 (mêmes valeurs d'exemple en commentaire) ;
  - `IngredientRow`, `toRow` et `cleanIngredients` portent les nouveaux champs et envoient `qty: null` pour `to_taste`.
- [ ] Lancer `npm run typecheck` et `npm run lint`. Les erreurs restantes de `DishForm.tsx` sont traitées aux tâches 22 et 23.
- [ ] Commit `feat(recettes): api client and vocabulary for the new recipe lines`.

### Task 22 : lignes d'ingrédients et création d'un ingrédient

**Files :** Modify `components/chef/recipes/DishForm.tsx` ; Create `components/chef/recipes/IngredientCreateDialog.tsx`.

- [ ] Ligne d'ingrédient :
  - recherche (communs et ses ingrédients, marqués « à valider ») ;
  - unité en liste ; quantité masquée pour « selon le goût » ;
  - « Facultatif », précision, préparation, groupe ;
  - « Caché au client », prérempli pour un ingrédient de base ;
  - texte d'origine sur une ligne « à vérifier ».
- [ ] « Créer « … » » quand rien ne correspond. Une fenêtre demande nom, rayon, allergènes ou « aucun », régimes, mois et « de base » ; à la création, la ligne est reliée. Un 409 propose l'ingrédient existant.
- [ ] Un doublon (422) met les lignes en cause en évidence.
- [ ] Lancer `npm run typecheck` et `npm run lint` : OK.
- [ ] Commit `feat(recettes): ingredient lines linked to the common list`.

### Task 23 : allergènes, conservation, contrôle et conflit

**Files :** Modify `components/chef/recipes/DishForm.tsx`.

- [ ] Bloc allergènes :
  - allergènes calculés avec leurs ingrédients (« Lait : beurre, crème ») et « si utilisé » ;
  - les 14 allergènes à ajouter, sans pouvoir décocher un allergène calculé ;
  - « Autre » ;
  - bouton de confirmation, désactivé avec l'explication tant qu'une ligne n'est pas reliée.
- [ ] Conservation (« Congelable », mois, décongélation) et consignes de réchauffage obligatoires.
- [ ] Panneau « Ce qu'il manque » : libellés français des nouveaux codes, chacun avec un lien vers son champ.
- [ ] Conflit : chaque enregistrement envoie `lockVersion`. Sur un 409, un bandeau « Cette recette a été modifiée ailleurs » avec « Recharger », et l'enregistrement automatique s'arrête.
- [ ] Lancer `npm run typecheck`, `npm run lint` et `npm run build` : OK.
- [ ] Commit `feat(recettes): computed allergens, storage and conflict in the recipe form`.

### Task 24 : historique, « Mes ingrédients » et notifications

**Files :** Create `components/chef/recipes/RecipeHistory.tsx`, `app/espace-chef/ingredients/page.tsx` ; Modify `DishForm.tsx`, `components/chef/ChefNav.tsx`, `components/chef/ChefSignals.tsx`.

- [ ] Historique dans la fiche : liste des versions, contenu d'une version, « Restaurer » avec confirmation.
- [ ] Page « Mes ingrédients » : en attente, validés, remplacés (avec le nom du commun), modifiables tant qu'ils sont en attente, avec le rappel que la modification touche ses recettes.
- [ ] Lien dans la navigation. Libellés et liens des quatre nouveaux types dans la cloche.
- [ ] Vitrine (`/menu`, `/chefs/[id]`) :
  - `gluten-free` et `lactose-free` suivis de « traces possibles pendant la préparation » ;
  - les allergènes de `conditionalAllergens` suivis de « si l'ingrédient facultatif est utilisé ».
- [ ] Lancer `npm run typecheck`, `npm run lint` et `npm run build` : OK.
- [ ] Commit `feat(recettes): recipe history, my ingredients, new notifications`.

## Partie C — console (`admin-dashboard`)

### Task 25 : ingrédients, file « À valider » et import

**Files :** Modify `lib/api/catalog.ts`, `app/(admin)/ingredients/page.tsx` ; Create `app/(admin)/ingredients/a-valider/page.tsx`, `app/(admin)/ingredients/import/page.tsx`.

- [ ] Créer la branche selon les Global Constraints.
- [ ] Page « Ingrédients » :
  - nouveaux champs (rayon, allergènes ou « aucun », de base, actif ou non) ;
  - filtres statut, rayon, « à compléter », « relu » ;
  - « Marquer comme relu » ;
  - avant d'enregistrer un changement d'allergènes, de régimes ou de mois, l'impact (`GET …/impact`) affiché et confirmé.
- [ ] File « À valider » : l'ingrédient, son chef, ses recettes, les communs proches (recherche sur son nom) ; actions « Valider », « Fusionner avec… », « Corriger puis valider ».
- [ ] Import : coller ou choisir le fichier, simulation avec le bilan et les erreurs par ligne, puis confirmation.
- [ ] Lancer `npm run typecheck`, `npm run lint` et `npm run build` : OK.
- [ ] Commit `feat(recettes): common list review, validation queue and import`.

### Task 26 : rayons et recettes LAB'S FOOD

**Files :** Modify `lib/api/admin.ts`, `app/(admin)/parametres/page.tsx`, `components/admin/MealForm.tsx`, `lib/recipe-fields.ts`.

- [ ] Paramètres : liste des rayons, sur le modèle des modes de réchauffage (`/admin/settings/aisles`).
- [ ] `MealForm` : lignes au nouveau format (recherche dans les communs seulement), allergènes calculés et ajoutés, conservation et réchauffage complets.
- [ ] Lancer `npm run typecheck`, `npm run lint` et `npm run build` : OK.
- [ ] Commit `feat(recettes): aisles setting and Lab's Food recipe form`.

### Task 27 : vérification finale

- [ ] API : `npm test`, `npm run lint`, `npm run build`. Fronts : `npm run typecheck`, `npm run lint`, `npm run build`. Tout passe.
- [ ] Lancer le skill `security-review` sur la branche de l'API, et corriger ce qu'il trouve.
- [ ] Demander l'accord de l'utilisateur pour appliquer la migration sur la base Docker locale. Avec cet accord, dérouler ce parcours dans les applications lancées :
  1. l'admin importe la liste ;
  2. un chef crée une recette avec un ingrédient à lui, la confirme et la passe « Prête » ;
  3. l'admin modifie un ingrédient de cette recette ;
  4. le chef voit la notification, recharge et reconfirme.

  Rejouer aussi les envois invalides de la tâche 8 avec `curl`.
- [ ] Rédiger le compte rendu pour l'utilisateur : ce qui est fait, testé, non testé, et les points du §13 de la spec à voir avec Daniel.
