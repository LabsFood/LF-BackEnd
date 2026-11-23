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

describe('EXTRACTION_SCHEMA, enums', () => {
  it('ne déclare jamais un enum sur un type multiple (refusé par Anthropic)', () => {
    const check = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if ('enum' in obj) expect(typeof obj.type).toBe('string');
      Object.values(obj).forEach(check);
    };
    check(EXTRACTION_SCHEMA);
  });
});

describe('EXTRACTION_SCHEMA, unions', () => {
  it('reste sous la limite Anthropic de 16 paramètres à type union', () => {
    let unions = 0;
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.type) || 'anyOf' in obj) unions++;
      Object.values(obj).forEach(walk);
    };
    walk(EXTRACTION_SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it('remet à null les textes libres rendus vides', () => {
    const out = parseExtraction(
      JSON.stringify({
        recipes: [
          {
            description: '',
            portionsNote: ' ',
            reheatingNote: 'Micro-ondes',
            ingredients: [{ preparation: '', group: 'Sauce' }],
          },
        ],
        warnings: [],
      }),
    );
    const r = out.recipes[0];
    expect(r.description).toBeNull();
    expect(r.portionsNote).toBeNull();
    expect(r.reheatingNote).toBe('Micro-ondes');
    expect(r.ingredients[0].preparation).toBeNull();
    expect(r.ingredients[0].group).toBe('Sauce');
  });
});
