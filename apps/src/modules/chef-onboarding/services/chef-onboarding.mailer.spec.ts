import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../../integrations/brevo.service';
import { ChefOnboardingMailer } from './chef-onboarding.mailer';

const mailer = (publicSiteUrl?: string) =>
  new ChefOnboardingMailer(
    { templates: {} } as unknown as BrevoService,
    {
      get: (key: string, fallback?: unknown) =>
        key === 'chefOnboarding.publicSiteUrl' ? (publicSiteUrl ?? fallback) : fallback,
    } as unknown as ConfigService,
  );

describe('ChefOnboardingMailer.signInUrl', () => {
  // A contract with the site: its `/auth/login` page renders Clerk's `<SignIn />`,
  // which redeems `__clerk_ticket` and moves on to `/apres-connexion`.
  it('opens the site’s sign-in page with the Clerk ticket', () => {
    expect(mailer('https://preprod.batchcooking.example/').signInUrl('sit_abc.def')).toBe(
      'https://preprod.batchcooking.example/auth/login?__clerk_ticket=sit_abc.def',
    );
  });

  it('defaults to the batch cooking site, where that page lives', () => {
    expect(mailer().signInUrl('sit_1')).toBe(
      'https://batchcooking.labsfood.fr/auth/login?__clerk_ticket=sit_1',
    );
  });

  it('encodes the ticket', () => {
    expect(mailer().signInUrl('a+b/c=')).toContain('__clerk_ticket=a%2Bb%2Fc%3D');
  });
});
