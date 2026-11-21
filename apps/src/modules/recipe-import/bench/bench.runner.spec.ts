import { aggregate, formatReport, runBench } from './bench.runner';
import type { Provider, SourceFile } from './providers';
import type { Extraction } from '../extraction/schema';

const index = new Map([
  ['oignon', 'Oignon'],
  ['tomate', 'Tomate'],
]);

function extraction(names: string[], steps = 1): Extraction {
  return {
    warnings: [],
    recipes: [
      {
        name: 'Sauce',
        description: null,
        portions: 4,
        portionsNote: null,
        prepMinutes: 10,
        cookMinutes: null,
        difficulty: null,
        category: null,
        country: null,
        ingredients: names.map((name) => ({
          rawText: name,
          qty: 1,
          unit: 'piece',
          name,
          preparation: null,
          optional: false,
          group: null,
          certain: true,
        })),
        steps: Array.from({ length: steps }, () => ({
          text: 'Cuire',
          type: null,
          durationMinutes: null,
        })),
        storageDays: null,
        freezable: null,
        reheatingNote: null,
        equipment: [],
        suspectedAllergens: [],
        estimatedFields: [],
        warnings: [],
      },
    ],
  };
}

const fake = (id: string, answer: Extraction | Error, supports = true): Provider => ({
  id,
  supports: () => supports,
  extract: () =>
    answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve({
          text: JSON.stringify(answer),
          inputTokens: 1000,
          outputTokens: 500,
          pages: 0,
        }),
  cost: () => 0.01,
});

const file = (name: string, kind: SourceFile['kind'] = 'pdf'): SourceFile => ({
  name,
  kind,
  mimeType: 'application/pdf',
  data: Buffer.from(''),
});

describe('runBench', () => {
  it('note chaque fiche avec chaque modèle et agrège par source', async () => {
    let t = 0;
    const report = await runBench(
      [file('a.pdf'), file('b.pdf')],
      [
        fake('bon', extraction(['Oignons', 'tomate'])),
        fake('moyen', extraction(['oignon', 'courgette'])),
      ],
      index,
      { now: () => (t += 100) },
    );
    expect(report.runs).toHaveLength(4);
    const bon = report.aggregates.find((a) => a.provider === 'bon');
    const moyen = report.aggregates.find((a) => a.provider === 'moyen');
    expect(bon).toMatchObject({ runs: 2, linkRate: 1, passes: true, missingFields: 4 });
    expect(moyen).toMatchObject({ linkRate: 0.5, passes: false });
    expect(formatReport(report)).toContain('courgette (2)');
  });

  it("garde l'échec d'un modèle sans arrêter le banc, et l'échec fait rater le seuil", async () => {
    const report = await runBench(
      [file('a.pdf')],
      [fake('ko', new Error('HTTP 500')), fake('ok', extraction(['tomate']))],
      index,
    );
    expect(report.runs.map((r) => r.ok)).toEqual([false, true]);
    expect(report.aggregates.find((a) => a.provider === 'ko')?.passes).toBe(false);
    expect(formatReport(report)).toContain('ko / a.pdf : HTTP 500');
  });

  it('saute les fiches qu’un modèle ne sait pas lire', async () => {
    const report = await runBench(
      [file('a.pdf')],
      [fake('texte', extraction([]), false)],
      index,
    );
    expect(report.runs).toHaveLength(0);
  });

  it('compte une recette sans étapes et une réponse JSON invalide comme un échec', async () => {
    const broken: Provider = {
      ...fake('broken', extraction([])),
      extract: () =>
        Promise.resolve({
          text: 'pas du json',
          inputTokens: 0,
          outputTokens: 0,
          pages: 0,
        }),
    };
    const report = await runBench(
      [file('a.pdf', 'livre')],
      [broken, fake('sans-etapes', extraction(['tomate'], 0))],
      index,
    );
    expect(report.runs[0].ok).toBe(false);
    expect(
      aggregate(report.runs).find((a) => a.provider === 'sans-etapes')
        ?.recipesWithoutSteps,
    ).toBe(1);
  });
});
