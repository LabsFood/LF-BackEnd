import { readFileSync } from 'fs';
import { join } from 'path';

import { catalogIndexFromCsv, parseExtraction, scoreExtraction } from './scoring';
import { EXTRACTION_SCHEMA } from './schema';

describe('catalogIndexFromCsv', () => {
  it('construit l’index depuis le CSV de référence, autres noms compris', () => {
    const csv = readFileSync(
      join(__dirname, '../../../../prisma/data/ingredients-v1.csv'),
      'utf8',
    );
    const index = catalogIndexFromCsv(csv);
    expect(index.get('oignon')).toBe('Oignon');
    expect(index.size).toBeGreaterThan(300);
  });
});

describe('parseExtraction', () => {
  it('accepte un JSON entouré d’un bloc de code', () => {
    expect(parseExtraction('```json\n{"recipes":[]}\n```')).toEqual({
      recipes: [],
      warnings: [],
    });
  });

  it('refuse une réponse sans recettes', () => {
    expect(() => parseExtraction('{"foo":1}')).toThrow('recipes');
  });
});

describe('scoreExtraction', () => {
  it('sépare lignes reliées, lignes incertaines et unités inconnues', () => {
    const line = (name: string, certain: boolean, unit: string | null) => ({
      rawText: name,
      qty: null,
      unit,
      name,
      preparation: null,
      optional: false,
      group: null,
      certain,
    });
    const score = scoreExtraction(
      {
        warnings: [],
        recipes: [
          {
            name: 'x',
            description: null,
            portions: null,
            portionsNote: null,
            prepMinutes: null,
            cookMinutes: null,
            difficulty: null,
            category: null,
            country: null,
            ingredients: [line('Oignons', true, 'g'), line('truc', false, 'poignée')],
            steps: [],
            storageDays: null,
            freezable: null,
            reheatingNote: null,
            equipment: [],
            suspectedAllergens: [],
            estimatedFields: ['portions'],
            warnings: [],
          },
        ],
      },
      new Map([['oignon', 'Oignon']]),
    );
    expect(score).toMatchObject({
      ingredients: 2,
      linked: 1,
      linkRate: 0.5,
      certainIngredients: 1,
      certainLinked: 1,
      invalidUnits: 1,
      recipesWithoutSteps: 1,
      missingFields: 4,
      estimatedFields: 1,
      unlinkedNames: ['truc'],
    });
  });
});

describe('EXTRACTION_SCHEMA', () => {
  it('rend toutes les clés obligatoires, comme l’exigent les sorties structurées strictes', () => {
    const check = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object') {
        expect(obj.additionalProperties).toBe(false);
        expect([...(obj.required as string[])].sort()).toEqual(
          Object.keys(obj.properties as object).sort(),
        );
      }
      Object.values(obj).forEach(check);
    };
    check(EXTRACTION_SCHEMA);
  });
});
