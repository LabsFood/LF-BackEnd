import { matchCommune } from './commune.rules';

describe('matchCommune — the town must be one the postcode serves', () => {
  // geo.api.gouv.fr, `communes?codePostal=…`.
  const montreuil = { nom: 'Montreuil', code: '93048', codeDepartement: '93' };
  const ain = [
    { nom: "L'Abergement-Clémenciat", code: '01001', codeDepartement: '01' },
    { nom: 'Châtillon-sur-Chalaronne', code: '01093', codeDepartement: '01' },
  ];

  it('refuses Marseille on 93100', () => {
    expect(matchCommune('Marseille', [montreuil])).toBeUndefined();
  });

  it('finds the commune whatever the case, accents, hyphens or apostrophes', () => {
    expect(matchCommune('  montreuil ', [montreuil])).toBe(montreuil);
    expect(matchCommune('chatillon sur chalaronne', ain)).toBe(ain[1]);
    expect(matchCommune('L’Abergement Clemenciat', ain)).toBe(ain[0]);
  });

  it('finds nothing for a postcode that serves no commune', () => {
    expect(matchCommune('Montreuil', [])).toBeUndefined();
  });
});
