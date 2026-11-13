-- Recettes §4.10 / BLK-33: a starting set for the common ingredient list, so a batch
-- cooker has something to adopt and a recipe line something to link.
--
-- Not applied by anyone but the user. Insert-only: an entry that already exists (the
-- name is unique) is left untouched, so what the admin typed wins.
--
-- Diets are stated conservatively: an ingredient carries a diet only when it clearly
-- suits it, because a dish is "sans gluten" or "sans lactose" only if EVERY ingredient
-- is (classification.rules.ts). Cheeses, bread, stock cubes and sauces are left out on
-- purpose: their make-up varies, so the admin decides. `halal` and `kosher` are declared
-- by the chef, never by an ingredient. Seasons are metropolitan France; empty means all year.
INSERT INTO "catalog_ingredients" ("name", "aliases", "diets", "season_months")
VALUES
  ('Tomate', ARRAY['tomates']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8, 9]::INTEGER[]),
  ('Courgette', ARRAY['courgettes']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8, 9]::INTEGER[]),
  ('Aubergine', ARRAY['aubergines']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[7, 8, 9]::INTEGER[]),
  ('Poivron', ARRAY['poivrons']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8, 9]::INTEGER[]),
  ('Concombre', ARRAY['concombres']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8]::INTEGER[]),
  ('Carotte', ARRAY['carottes']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Pomme de terre', ARRAY['patate', 'patates', 'pommes de terre']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Patate douce', ARRAY['patates douces']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[1, 2, 9, 10, 11, 12]::INTEGER[]),
  ('Oignon', ARRAY['oignons']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Échalote', ARRAY['echalote', 'echalotes', 'échalotes']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Ail', ARRAY['gousse d''ail', 'gousses d''ail']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Poireau', ARRAY['poireaux']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[1, 2, 3, 9, 10, 11, 12]::INTEGER[]),
  ('Chou-fleur', ARRAY['chou fleur', 'choux-fleurs']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[1, 2, 3, 10, 11, 12]::INTEGER[]),
  ('Épinards', ARRAY['epinard', 'epinards', 'épinard']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[3, 4, 5, 9, 10, 11]::INTEGER[]),
  ('Champignon de Paris', ARRAY['champignon', 'champignons', 'champignons de paris']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Potiron', ARRAY['citrouille', 'courge', 'potimarron']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[9, 10, 11, 12]::INTEGER[]),
  ('Haricots verts', ARRAY['haricot vert']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8, 9]::INTEGER[]),
  ('Petits pois', ARRAY['petit pois']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[5, 6, 7]::INTEGER[]),
  ('Salade verte', ARRAY['laitue', 'salade']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Pomme', ARRAY['pommes']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[1, 2, 3, 9, 10, 11, 12]::INTEGER[]),
  ('Citron', ARRAY['citrons']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Persil', ARRAY['persil frais', 'persil frise', 'persil frisé', 'persil plat']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Basilic', ARRAY['basilic frais', 'feuilles de basilic']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[6, 7, 8, 9]::INTEGER[]),
  ('Riz', ARRAY['riz basmati', 'riz blanc']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Quinoa', ARRAY['quinoa blanc', 'quinoa tricolore']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Pâtes sèches', ARRAY['pates', 'pates seches', 'penne', 'pâtes', 'spaghetti']::TEXT[], ARRAY['lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Semoule de blé', ARRAY['couscous', 'semoule', 'semoule de ble']::TEXT[], ARRAY['lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Farine de blé', ARRAY['farine', 'farine de ble']::TEXT[], ARRAY['lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Lentilles', ARRAY['lentille']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Pois chiches', ARRAY['pois chiche']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Haricots rouges', ARRAY['haricot rouge']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Tofu', ARRAY['tofu ferme', 'tofu nature']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Lait de coco', ARRAY['lait coco']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Huile d''olive', ARRAY['huile olive']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegan', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Poulet', ARRAY['blanc de poulet', 'cuisse de poulet', 'filet de poulet']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork']::TEXT[], ARRAY[]::INTEGER[]),
  ('Bœuf', ARRAY['boeuf', 'steak hache', 'steak haché']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork']::TEXT[], ARRAY[]::INTEGER[]),
  ('Porc', ARRAY['filet de porc', 'roti de porc', 'rôti de porc']::TEXT[], ARRAY['gluten-free', 'lactose-free']::TEXT[], ARRAY[]::INTEGER[]),
  ('Saumon', ARRAY['filet de saumon', 'pave de saumon', 'pavé de saumon']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Œuf', ARRAY['oeuf', 'oeufs', 'œufs']::TEXT[], ARRAY['gluten-free', 'lactose-free', 'no-pork', 'pescetarian', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Lait', ARRAY['lait de vache']::TEXT[], ARRAY['gluten-free', 'no-pork', 'pescetarian', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Beurre', ARRAY['beurre demi-sel', 'beurre doux', 'beurre sale', 'beurre salé']::TEXT[], ARRAY['gluten-free', 'no-pork', 'pescetarian', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[]),
  ('Crème fraîche', ARRAY['creme', 'creme fraiche', 'crème']::TEXT[], ARRAY['gluten-free', 'no-pork', 'pescetarian', 'vegetarian']::TEXT[], ARRAY[]::INTEGER[])
ON CONFLICT ("name") DO NOTHING;
