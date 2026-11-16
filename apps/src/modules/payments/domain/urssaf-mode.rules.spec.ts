import { adminMayAnswer, commissionDueAutomatically } from './urssaf-mode.rules';

describe('urssaf-mode rules', () => {
  it('lets an admin answer in simulated and manual modes only', () => {
    expect(adminMayAnswer('simulated')).toBe(true);
    expect(adminMayAnswer('manual')).toBe(true);
    expect(adminMayAnswer('disabled')).toBe(false);
  });

  it('leaves the commission for the admin to collect in manual mode', () => {
    expect(commissionDueAutomatically('manual')).toBe(false);
    expect(commissionDueAutomatically('simulated')).toBe(true);
  });
});
