import {
  CONTACT_MASK,
  detectContact,
  detectSplitContact,
  maskContact,
} from './contact-detector';

describe('contact detector', () => {
  it.each([
    'Appelez-moi au 06 12 34 56 78',
    'mon numéro : 0612345678',
    '+33 6 12 34 56 78 si besoin',
    '06.12.34.56.78',
    '06-12-34-56-78',
    'écrivez à sophie.marchand@example.fr',
    // Spelled out, in words, or mixed with digits.
    'zéro six douze trente-quatre cinquante-six soixante-dix-huit',
    'Zero six un deux trois quatre cinq six sept huit',
    'mon numéro : zéro six, quatre-vingt-dix-sept, 12, 34, 56',
    '06 douze 34 56 78',
    'six zéro un deux trois quatre cinq six sept huit',
    'sophie arobase gmail point com',
    'sophie (at) gmail (dot) com',
    'sophie.m[at]orange.fr',
    'je suis sur gmail point com',
  ])('detects a contact detail in %p', (text) => {
    expect(detectContact(text)).toBe(true);
    expect(maskContact(text)).toContain(CONTACT_MASK);
  });

  it.each([
    'Prestation n° LF-2026-0142, à jeudi !',
    'Rendez-vous le 12/10/2026 à 14h30',
    'Il me faut 250 g de beurre et 12 œufs',
    'Le devis est à 480 € pour 12 personnes',
    'Code de la porte : 4512B',
    'Il me faut deux kilos, trois oignons et quatre carottes',
    'Rendez-vous à huit heures, on fait douze portions',
    'Le 12/10/2026 14:30, 250 g et 12 œufs',
    'Je serai là at 10h, merci',
  ])('leaves %p alone', (text) => {
    expect(detectContact(text)).toBe(false);
    expect(maskContact(text)).toBe(text);
  });

  it('masks only the contact detail', () => {
    expect(maskContact('Mon mail est a@b.fr, merci')).toBe(
      `Mon mail est ${CONTACT_MASK}, merci`,
    );
  });

  it('gives the same answer when called twice', () => {
    const text = 'Tel 0612345678';
    expect(detectContact(text)).toBe(true);
    expect(detectContact(text)).toBe(true);
  });

  it('masks a spelled-out number without touching the sentence', () => {
    expect(
      maskContact(
        'Appelle zéro six douze trente-quatre cinquante-six soixante-dix-huit ok',
      ),
    ).toBe(`Appelle ${CONTACT_MASK} ok`);
    expect(maskContact('écris à sophie arobase gmail point com merci')).toBe(
      `écris à ${CONTACT_MASK} merci`,
    );
  });

  it('masks every number run of a message that is part of a split number', () => {
    expect(maskContact("mon num c'est 06 12", true)).toBe(
      `mon num c'est ${CONTACT_MASK}`,
    );
    expect(maskContact('6', true)).toBe(CONTACT_MASK);
    expect(maskContact('dix', true)).toBe(CONTACT_MASK);
    expect(maskContact('merci', true)).toBe('merci');
  });
});

describe('detectSplitContact', () => {
  it('catches a number sent one digit per message', () => {
    const digits = ['0', '6', '1', '2', '3', '4', '5', '6', '7'];
    // The ninth digit completes a number: eight earlier messages plus this one.
    expect(detectSplitContact(digits, '8')).toBe(8);
  });

  it('flags only the messages that make the number', () => {
    expect(detectSplitContact(['bonjour', '06 12', '34', '56'], '78')).toBe(3);
  });

  it('catches words split over messages', () => {
    expect(
      detectSplitContact(
        ['zéro', 'six', 'douze', 'trente-quatre', 'cinquante-six'],
        'soixante-dix-huit',
      ),
    ).toBe(4);
  });

  it('catches the start of a number written at the end of a sentence', () => {
    expect(detectSplitContact(['mon numéro : 06 12', '34 56'], '78 merci')).toBe(2);
  });

  it('stays quiet while the number is incomplete', () => {
    expect(detectSplitContact(['0', '6', '1'], '2')).toBe(0);
  });

  it('is broken by a message that is not a number', () => {
    expect(detectSplitContact(['0612', 'bonjour', '3456'], '78')).toBe(0);
  });

  it('ignores a message with no digit in it', () => {
    expect(
      detectSplitContact(['0', '6', '1', '2', '3', '4', '5', '6', '7'], 'merci'),
    ).toBe(0);
  });
});
