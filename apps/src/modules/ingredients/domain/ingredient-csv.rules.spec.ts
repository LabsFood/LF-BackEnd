import { parseIngredientCsv } from './ingredient-csv.rules';

const AISLES = ['fruits-legumes', 'boulangerie', 'epicerie'];
const HEADER = 'nom;autres_noms;rayon;allergenes;aucun_allergene;regimes;mois;base;doute';

const parse = (...lines: string[]) => parseIngredientCsv(lines.join('\n'), AISLES);

describe('parseIngredientCsv (Recettes §7.4)', () => {
  it('reads a full row: lists with |, oui/non, doute ignored', () => {
    const { rows, errors } = parse(
      HEADER,
      'Tomate;pomme d’amour|tomate ronde;fruits-legumes;;oui;vegan|gluten-free;6|7|8;non;à revoir',
      'Farine;;epicerie;gluten;non;vegan;;OUI;',
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        name: 'Tomate',
        aliases: ['pomme d’amour', 'tomate ronde'],
        aisle: 'fruits-legumes',
        allergensNone: true,
        diets: ['vegan', 'gluten-free'],
        seasonMonths: [6, 7, 8],
        isBasic: false,
      },
      {
        name: 'Farine',
        aisle: 'epicerie',
        allergens: ['gluten'],
        diets: ['vegan'],
        isBasic: true,
      },
    ]);
  });

  it('accepts a BOM, CRLF, any column order and a final blank line', () => {
    const header =
      'rayon;nom;allergenes;aucun_allergene;autres_noms;regimes;mois;base;doute';
    const text = `﻿${header}\r\nboulangerie;Pain;gluten;;;;;;\r\n\r\n`;
    const { rows, errors } = parseIngredientCsv(text, AISLES);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ name: 'Pain', aisle: 'boulangerie', allergens: ['gluten'] }]);
  });

  it('supports quoted cells holding the separator and doubled quotes', () => {
    const { rows, errors } = parse(HEADER, '"Sel; fin";"a ""b""";epicerie;;oui;;;oui;');
    expect(errors).toEqual([]);
    expect(rows[0].name).toBe('Sel; fin');
    expect(rows[0].aliases).toEqual(['a "b"']);
  });

  it('reports a missing column once, on line 1, and reads no row', () => {
    const { rows, errors } = parse('nom;rayon', 'Tomate;epicerie');
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toContain('autres_noms');
  });

  it('reports an unknown column on line 1', () => {
    const { errors } = parse(`${HEADER};extra`, 'a;;epicerie;;oui;;;;;');
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
  });

  it.each([
    ['an unknown aisle', 'Tomate;;cave;;oui;;;;', 'cave'],
    ['an unknown allergen', 'Tomate;;epicerie;kryptonite;;;;;', 'kryptonite'],
    ['an unknown diet', 'Tomate;;epicerie;;oui;paleo;;;', 'paleo'],
    ['month 13', 'Tomate;;epicerie;;oui;;6|13;;', '13'],
    ['month 0', 'Tomate;;epicerie;;oui;;0;;', '0'],
    ['a month that is no integer', 'Tomate;;epicerie;;oui;;6.5;;', '6.5'],
    ['a duplicate month', 'Tomate;;epicerie;;oui;;6|6;;', '6'],
    ['a duplicate allergen', 'Tomate;;epicerie;gluten|gluten;;;;;', 'gluten'],
    [
      'allergens with aucun_allergene oui',
      'Tomate;;epicerie;gluten;oui;;;;',
      'aucun_allergene',
    ],
    ['neither allergens nor aucun_allergene', 'Tomate;;epicerie;;;;;;', 'allerg'],
    ['aucun_allergene non without allergens', 'Tomate;;epicerie;;non;;;;', 'allerg'],
    ['a boolean that is not oui/non', 'Tomate;;epicerie;;peut-être;;;;', 'peut-être'],
    ['a base that is not oui/non', 'Tomate;;epicerie;;oui;;;1;', 'base'],
    ['an empty name', ';;epicerie;;oui;;;;', 'nom'],
    ['a name of 121 characters', `${'a'.repeat(121)};;epicerie;;oui;;;;`, 'nom'],
    [
      'an alias of 121 characters',
      `Tomate;${'a'.repeat(121)};epicerie;;oui;;;;`,
      'autres_noms',
    ],
    [
      '21 aliases',
      `Tomate;${Array.from({ length: 21 }, (_, i) => `n${i}`).join('|')};epicerie;;oui;;;;`,
      'autres_noms',
    ],
    ['too few cells', 'Tomate;epicerie', 'colonnes'],
  ])('flags %s on its own line', (_label, row, mention) => {
    const { rows, errors } = parse(HEADER, 'Pain;;boulangerie;gluten;;;;;', row);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toContain(mention);
  });

  it('puts one error per bad line, line numbers 1-based with the header at 1', () => {
    const { errors } = parse(
      HEADER,
      'A;;cave;;oui;;;;',
      'B;;epicerie;;oui;;;;',
      'C;;cave;;oui;;;;',
    );
    expect(errors.map((e) => e.line)).toEqual([2, 4]);
  });

  it('refuses the second row of the same normalized name', () => {
    const { rows, errors } = parse(
      HEADER,
      'Crème fraîche;;epicerie;milk;;;;;',
      'creme  FRAICHE;;epicerie;milk;;;;;',
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it('answers a single error and no row above 2,000 data lines', () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `Item ${i};;epicerie;;oui;;;;`);
    const { rows, errors } = parse(HEADER, ...lines);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    const ok = parse(HEADER, ...lines.slice(0, 2000));
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toHaveLength(2000);
  });

  it('strips control characters from the name', () => {
    const { rows } = parse(HEADER, 'To\u0007mate;;epicerie;;oui;;;;');
    expect(rows[0].name).toBe('Tomate');
  });

  describe('strictness (Task 20A)', () => {
    it.each([
      ['"Sel"fin;;epicerie;;oui;;;;', 'caractère inattendu après un guillemet fermant'],
      ['"Sel" ;;epicerie;;oui;;;;', 'caractère inattendu après un guillemet fermant'],
      ['Sel;"a"b;epicerie;;oui;;;;', 'caractère inattendu après un guillemet fermant'],
    ])('refuses text after a closing quote: %s', (line, message) => {
      const { rows, errors } = parse(HEADER, line);
      expect(rows).toEqual([]);
      expect(errors).toEqual([{ line: 2, message: expect.stringContaining(message) }]);
    });

    it('still accepts a closing quote before the separator, a line end or the end', () => {
      const { rows, errors } = parse(
        HEADER,
        '"Sel";"x";epicerie;;oui;;;;"a"',
        'Poivre;;epicerie;;oui;;;;"b"',
      );
      expect(errors).toEqual([]);
      expect(rows.map((r) => r.name)).toEqual(['Sel', 'Poivre']);
    });

    it('refuses text after a closing quote in the header', () => {
      const { rows, errors } = parseIngredientCsv('"nom"x;rayon', AISLES);
      expect(rows).toEqual([]);
      expect(errors[0].line).toBe(1);
    });

    it('keeps the line numbers right after a quoted cell with a line break', () => {
      const { rows, errors } = parse(
        HEADER,
        '"Sel\nfin";;epicerie;;oui;;;;',
        'A;;cave;;oui;;;;',
        'B;;epicerie;;oui;;;;',
        'C;;cave;;oui;;;;',
      );
      expect(rows.map((r) => r.name)).toEqual(['Sel fin', 'B']);
      expect(errors.map((e) => e.line)).toEqual([4, 6]);
    });

    it('counts a CRLF inside a quoted cell as one line break', () => {
      const text = [HEADER, '"Sel\r\nfin";;epicerie;;oui;;;;', 'A;;cave;;oui;;;;'].join(
        '\r\n',
      );
      const { errors } = parseIngredientCsv(text, AISLES);
      expect(errors.map((e) => e.line)).toEqual([4]);
    });
  });
});
