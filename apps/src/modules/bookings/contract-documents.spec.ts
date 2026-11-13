import { existsSync } from 'node:fs';

import { textOf } from '../../common/pdf/pdf.test-helpers';
import {
  cgvPath,
  renderDeboursMandatePdf,
  renderWithdrawalFormPdf,
} from './contract-documents';
import { CONTRACT_TERMS } from './domain/contract.rules';

/** PDF text, with line breaks and runs of spaces read as one space. */
const flat = (pdf: Buffer) => textOf(pdf).replace(/\s+/g, ' ');

describe('renderWithdrawalFormPdf', () => {
  it('is the Annexe 1 form, pre-filled with the booking', async () => {
    const pdf = await renderWithdrawalFormPdf({
      reference: 'LF-2026-0042',
      chefName: 'Marie Dupont EI',
      bookedOn: new Date('2026-11-28T23:30:00.000Z'),
      clientName: 'Sophie Martin',
      clientAddress: '3 rue des Lilas, 93100 Montreuil',
    });
    const text = flat(pdf);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    for (const fact of [
      'Formulaire de rétractation',
      'Je vous notifie par la présente ma rétractation',
      'retractation@labsfood.fr',
      // The model form names the professional's geographic address (R.221-1).
      '200 rue de la Croix Nivert, 75015 Paris',
      'LF-2026-0042',
      'Marie Dupont EI',
      'Sophie Martin',
      '3 rue des Lilas, 93100 Montreuil',
      // The Paris day: 23:30 UTC on the 28th is the 29th there.
      '29 novembre 2026',
      'quatorze jours',
    ]) {
      expect(text).toContain(fact);
    }
  });
});

describe('renderDeboursMandatePdf', () => {
  let text: string;
  const input = {
    reference: 'LF-2026-0042',
    clientName: 'Sophie Martin',
    chefName: 'Marie Dupont EI',
    chefSiren: '443061841',
    startsAt: new Date('2026-12-10T08:00:00.000Z'),
    address: '3 rue des Lilas, 93100 Montreuil',
    meals: ['Dahl de lentilles', 'Gratin dauphinois'],
    shopping: ['Lentilles corail — 500 g', 'Pommes de terre — 2 kg'],
    acceptedAt: new Date('2026-12-01T09:15:00.000Z'),
    version: '1.0',
  };

  // Rendered once: a PDF with embedded fonts is the slow part of the suite.
  beforeAll(async () => {
    text = flat(await renderDeboursMandatePdf(input));
  });

  it('names the parties, the designated buyer, the prestation and the acceptance as signature', () => {
    for (const fact of [
      'Mandat de débours',
      'Sophie Martin',
      "LAB'S FOOD - BATCHCOOKING",
      'RCS Paris 131 895 203',
      'Marie Dupont EI',
      '443061841',
      'Dahl de lentilles',
      'Lentilles corail — 500 g',
      'au centime près',
      'article 1994 du Code civil',
      '1 décembre 2026',
      'version 1.0',
      'vaut signature',
    ]) {
      expect(text).toContain(fact);
    }
  });

  it('says where the list is while it does not exist yet', async () => {
    const text = flat(await renderDeboursMandatePdf({ ...input, shopping: [] }));
    expect(text).toContain('Liste de Courses');
    expect(text).toContain('pas encore établie');
  });
});

describe('cgvPath', () => {
  it('ships the PDF of the CGV version in force (to be dropped in by legal)', () => {
    expect(existsSync(cgvPath(CONTRACT_TERMS.version))).toBe(true);
  });
});
