import { routesFor } from './import-routes';

const pdf = { type: 'pdf' as const, base64: 'x', name: 'r.pdf' };
const image = { type: 'image' as const, mimeType: 'image/png', base64: 'x' };
const text = { type: 'text' as const, text: 'recette' };

describe('routesFor', () => {
  it('envoie un PDF à Mistral OCR', () => {
    expect(routesFor([pdf], false).map((r) => r.model)).toEqual(['mistral-ocr-latest']);
  });

  it('envoie les captures et le texte à Mistral Small', () => {
    expect(routesFor([image], false).map((r) => r.model)).toEqual([
      'mistral-small-latest',
    ]);
    expect(routesFor([image, image], false).map((r) => r.model)).toEqual([
      'mistral-small-latest',
    ]);
    expect(routesFor([text], false).map((r) => r.model)).toEqual([
      'mistral-small-latest',
    ]);
  });

  it('ajoute Haiku en renfort seulement si le hors UE est autorisé', () => {
    expect(routesFor([pdf], true).map((r) => r.model)).toEqual([
      'mistral-ocr-latest',
      'claude-haiku-5-5',
    ]);
    expect(routesFor([image], true).map((r) => r.provider)).toEqual([
      'mistral',
      'anthropic',
    ]);
  });
});
