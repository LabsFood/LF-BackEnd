import { CONTACT_MASK, detectContact, maskContact } from './contact-detector';

describe('contact detector', () => {
  it.each([
    'Appelez-moi au 06 12 34 56 78',
    'mon numéro : 0612345678',
    '+33 6 12 34 56 78 si besoin',
    '06.12.34.56.78',
    '06-12-34-56-78',
    'écrivez à sophie.marchand@example.fr',
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
});
