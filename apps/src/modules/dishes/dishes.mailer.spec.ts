import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../integrations/brevo.service';
import { DishesMailer } from './dishes.mailer';

function harness() {
  const brevo = {
    templates: { recipeAllergensChanged: 41, recipesMigrated: 42 },
    sendTemplate: jest.fn(async (_input: object) => ({ sent: true })),
  };
  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'chefOnboarding.publicSiteUrl' ? 'https://labsfood.example/' : fallback,
  };
  const mailer = new DishesMailer(
    brevo as unknown as BrevoService,
    config as unknown as ConfigService,
  );
  return { brevo, mailer };
}

describe('DishesMailer (Recettes §5.5)', () => {
  it('tells a chef how many of their dishes need their allergens confirmed again', async () => {
    const { brevo, mailer } = harness();

    await mailer.recipeAllergensChanged({
      email: 'marie@example.com',
      name: 'Marie Dupont',
      dishCount: 3,
    });

    expect(brevo.sendTemplate).toHaveBeenCalledWith({
      templateId: 41,
      to: { email: 'marie@example.com', name: 'Marie Dupont' },
      label: 'recipe-allergens-changed',
      params: {
        dishCount: 3,
        recipesUrl: 'https://labsfood.example/espace-chef/recettes',
      },
    });
  });

  it('tells a chef their recipes moved to the new form, with the lines to verify', async () => {
    const { brevo, mailer } = harness();

    await mailer.recipesMigrated({
      email: 'paul@example.com',
      name: null,
      dishCount: 7,
      linesToVerify: 4,
    });

    expect(brevo.sendTemplate).toHaveBeenCalledWith({
      templateId: 42,
      to: { email: 'paul@example.com', name: undefined },
      label: 'recipes-migrated',
      params: {
        dishCount: 7,
        linesToVerify: 4,
        recipesUrl: 'https://labsfood.example/espace-chef/recettes',
      },
    });
  });
});
