import type { ExtractedRecipe } from '../extraction/schema';
import {
  allergenGaps,
  certainLinkRate,
  duplicateOf,
  linkIndex,
  toDishDraft,
} from './draft.rules';
import { fileProblem, pdfInfo, sniffType } from './import-file.rules';
import {
  htmlToText,
  isPrivateAddress,
  pageForModel,
  schemaOrgRecipe,
  urlProblem,
} from './url-source.rules';

const recipe = (over: Partial<ExtractedRecipe> = {}): ExtractedRecipe => ({
  name: 'Poulet basquaise',
  description: null,
  portions: null,
  portionsNote: null,
  prepMinutes: null,
  cookMinutes: 45,
  difficulty: null,
  category: null,
  country: 'FR',
  ingredients: [],
  steps: [],
  storageDays: null,
  freezable: null,
  reheatingNote: null,
  equipment: [],
  suspectedAllergens: [],
  estimatedFields: [],
  warnings: [],
  ...over,
});

const ing = (
  name: string,
  over: Partial<ExtractedRecipe['ingredients'][number]> = {},
) => ({
  rawText: `2 ${name}`,
  qty: 2,
  unit: 'piece',
  name,
  preparation: null,
  optional: false,
  group: null,
  certain: true,
  ...over,
});

const index = linkIndex([
  { id: 'oignon-id', name: 'Oignon', aliases: ['oignon jaune'] },
  { id: 'poivron-id', name: 'Poivron', aliases: [] },
]);

describe('toDishDraft', () => {
  it('relie les lignes connues et met les autres à vérifier avec leur texte', () => {
    const { dish, linked, toVerify, unlinkedNames } = toDishDraft(
      recipe({
        ingredients: [
          ing('Oignons'),
          ing('piment d’Espelette', { unit: 'pinch', qty: 1 }),
        ],
      }),
      index,
    );
    expect(dish.recipe.ingredients[0]).toMatchObject({
      catalogIngredientId: 'oignon-id',
      toVerify: false,
      rawText: null,
    });
    expect(dish.recipe.ingredients[1]).toMatchObject({
      catalogIngredientId: null,
      toVerify: true,
      rawText: '2 piment d’Espelette',
    });
    expect({ linked, toVerify, unlinkedNames }).toEqual({
      linked: 1,
      toVerify: 1,
      unlinkedNames: ['piment d’espelette'],
    });
  });

  it('marque une ligne incertaine, sans unité ou sans quantité à vérifier, et vide la quantité « selon le goût »', () => {
    const { dish } = toDishDraft(
      recipe({
        ingredients: [
          ing('oignon', { certain: false }),
          ing('poivron', { unit: null, qty: null }),
          ing('oignon', { group: 'Sauce', unit: 'to_taste', qty: 3 }),
        ],
      }),
      index,
    );
    expect(dish.recipe.ingredients.map((l) => l.toVerify)).toEqual([true, true, false]);
    expect(dish.recipe.ingredients[2].qty).toBeNull();
  });

  it('laisse à vérifier le second doublon d’un même groupe', () => {
    const { dish } = toDishDraft(
      recipe({ ingredients: [ing('oignon'), ing('oignon jaune')] }),
      index,
    );
    expect(dish.recipe.ingredients[1]).toMatchObject({
      catalogIngredientId: null,
      toVerify: true,
    });
  });

  it('estime et marque portions et temps de préparation manquants', () => {
    const { dish, estimatedFields } = toDishDraft(
      recipe({
        steps: [
          { text: 'Émincer', type: 'preparation', durationMinutes: 15 },
          { text: 'Cuire', type: 'cuisson', durationMinutes: 45 },
        ],
      }),
      index,
    );
    expect(dish).toMatchObject({ portions: 4, prepMinutes: 15, cookMinutes: 45 });
    expect(estimatedFields).toEqual(['portions', 'prepMinutes']);
  });

  it('remplit la conservation seulement quand la source la donne', () => {
    expect(toDishDraft(recipe(), index).dish.recipe.storage).toBeUndefined();
    expect(
      toDishDraft(recipe({ storageDays: 3, freezable: true }), index).dish.recipe.storage,
    ).toEqual({
      method: 'fridge',
      days: 3,
      freezable: true,
    });
  });
});

describe('certainLinkRate', () => {
  it('ne compte que les lignes lues avec certitude', () => {
    expect(
      certainLinkRate(
        recipe({
          ingredients: [ing('oignon'), ing('truc'), ing('machin', { certain: false })],
        }),
        index,
      ),
    ).toBe(0.5);
  });
});

describe('duplicateOf / allergenGaps', () => {
  it('trouve un plat au même nom, accents et casse ignorés', () => {
    expect(
      duplicateOf('POULET Basquaise ', [{ id: '1', name: 'Poulet basquaise' }])?.id,
    ).toBe('1');
    expect(duplicateOf('Poulet', [{ id: '1', name: 'Poulet basquaise' }])).toBeNull();
  });

  it('liste les allergènes soupçonnés que le calcul ne trouve pas', () => {
    expect(allergenGaps(['milk', 'gluten', 'milk'], ['gluten'])).toEqual(['milk']);
  });
});

describe('fichiers', () => {
  const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}`, 'latin1');

  it('lit le vrai type, refuse HEIC et format inconnu', () => {
    expect(sniffType(pdf(''))).toBe('application/pdf');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic', 'latin1'),
    ]);
    expect(fileProblem(heic)?.message).toContain('HEIC');
    expect(fileProblem(Buffer.from('bonjour'))?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('refuse un PDF chiffré ou trop long', () => {
    expect(
      pdfInfo(pdf('<< /Type /Pages >> << /Type /Page >> << /Type/Page >>')).pages,
    ).toBe(2);
    expect(fileProblem(pdf('trailer << /Encrypt 5 0 R >>'))?.code).toBe('PDF_ENCRYPTED');
    expect(fileProblem(pdf('<< /Type /Page >>'.repeat(21)))?.code).toBe('PDF_TOO_LONG');
    expect(fileProblem(pdf('<< /Type /Page >>'))).toBeNull();
  });
});

describe('liens', () => {
  it('refuse les adresses internes et ce qui n’est pas https', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '172.20.0.1',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(urlProblem('http://example.com/r')).toContain('https');
    expect(urlProblem('https://127.0.0.1/r')).toContain('interne');
    expect(urlProblem('https://localhost/r')).toContain('interne');
    expect(urlProblem('https://user:pw@example.com/')).toContain('identifiants');
    expect(urlProblem('https://example.com:8443/')).toContain('Port');
    expect(urlProblem('https://www.marmiton.org/recettes/x.aspx')).toBeNull();
  });

  it('préfère la recette schema.org de la page, même dans un @graph', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Tarte","recipeIngredient":["2 œufs"]}]}</script>`;
    expect(schemaOrgRecipe(html)?.name).toBe('Tarte');
    expect(pageForModel(html, 'https://x.fr')).toContain('"recipeIngredient":["2 œufs"]');
  });

  it('retombe sur le texte lisible sans scripts', () => {
    expect(
      htmlToText(
        '<style>a{}</style><p>Crème &amp; sucre</p><script>x()</script><li>Œufs</li>',
      ),
    ).toBe('Crème & sucre\n Œufs');
  });
});
