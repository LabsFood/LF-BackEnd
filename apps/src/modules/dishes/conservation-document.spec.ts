import { conservationFilename, renderConservationPdf } from './conservation-document';

describe('the conservation sheet as a PDF (Recettes lot 3, LF-0272)', () => {
  it('renders a PDF with one panel per dish', async () => {
    const pdf = await renderConservationPdf({
      day: 'vendredi 20 novembre 2026',
      dishes: [
        {
          name: 'Curry de légumes',
          eatBefore: 'lundi 23 novembre',
          storage: 'Réfrigérateur, 3 jours, Boîte en verre',
          freezer: 'Se congèle, 3 mois au plus. Une nuit au réfrigérateur.',
          reheating: 'Micro-ondes, 3 min',
          chefNote: 'Remuer à mi-cuisson.',
        },
        {
          name: 'Soupe de potiron',
          eatBefore: null,
          storage: null,
          freezer: null,
          reheating: null,
          chefNote: null,
        },
      ],
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('names the file after the prestation day', () => {
    expect(conservationFilename('2026-11-20')).toBe('conservation-2026-11-20.pdf');
  });
});
