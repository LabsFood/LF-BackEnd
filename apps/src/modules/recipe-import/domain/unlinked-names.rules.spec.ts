import {
  closestEntry,
  ignoredFrom,
  MAX_IGNORED_NAMES,
  unlinkedProposals,
  withIgnored,
} from './unlinked-names.rules';

const piment = { id: 'p', name: 'Piment', aliases: [] };
const pimentRouge = { id: 'pr', name: 'Piment rouge', aliases: [] };
const citron = { id: 'c', name: 'Citron vert', aliases: ['lime'] };
const entries = [piment, pimentRouge, citron];

describe('closestEntry', () => {
  it('propose l’entrée la plus longue contenue en mots entiers', () => {
    expect(closestEntry('piment rouge thaï', entries)).toBe(pimentRouge);
    expect(closestEntry('pâte de piment', entries)).toBe(piment);
    expect(closestEntry('jus de lime', entries)).toBe(citron);
  });

  it('ne coupe pas les mots', () => {
    expect(closestEntry('pimentade', entries)).toBeNull();
    expect(closestEntry('galanga', entries)).toBeNull();
  });
});

describe('unlinkedProposals', () => {
  it('regroupe singulier et pluriel, garde la graphie la plus vue', () => {
    const out = unlinkedProposals(
      [
        { name: 'pâte de crevettes', count: 3, chefs: 2 },
        { name: 'pâte de crevette', count: 1, chefs: 1 },
      ],
      [],
      [],
    );
    expect(out).toEqual([
      { name: 'pâte de crevettes', count: 4, chefs: 2, suggestion: null },
    ]);
  });

  it('retire les noms que la liste connaît désormais (nom ou autre nom) et les écartés', () => {
    const out = unlinkedProposals(
      [
        { name: 'piments', count: 5, chefs: 2 },
        { name: 'LIME', count: 2, chefs: 1 },
        { name: 'huile', count: 4, chefs: 3 },
        { name: 'galanga', count: 6, chefs: 1 },
      ],
      entries,
      ['huile'],
    );
    expect(out.map((n) => n.name)).toEqual(['galanga']);
  });

  it('classe par fréquence et propose un rattachement', () => {
    const out = unlinkedProposals(
      [
        { name: 'citronnelle', count: 2, chefs: 1 },
        { name: 'piment rouge thaï', count: 5, chefs: 2 },
      ],
      entries,
      [],
    );
    expect(out.map((n) => [n.name, n.suggestion?.id ?? null])).toEqual([
      ['piment rouge thaï', 'pr'],
      ['citronnelle', null],
    ]);
  });
});

describe('noms écartés', () => {
  it('lit la valeur stockée et ignore le reste', () => {
    expect(ignoredFrom({ keys: ['huile', 3, ''] })).toEqual(['huile']);
    expect(ignoredFrom(null)).toEqual([]);
  });

  it('ajoute une clé sans doublon et borne la liste', () => {
    expect(withIgnored(['huile'], 'Huiles')).toEqual(['huile']);
    expect(withIgnored([], 'Échalote et ail')).toEqual(['echalote et ail']);
    const full = Array.from({ length: MAX_IGNORED_NAMES }, (_, i) => `k${i}`);
    expect(withIgnored(full, 'sel fin')).toHaveLength(MAX_IGNORED_NAMES);
  });
});
