import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrevoService } from '../../integrations/brevo.service';

/**
 * The FLOW-02 emails to batch cookers. Best-effort like FLOW-01's: an email
 * provider outage never undoes a moderation decision or a correction. Copy lives
 * in Brevo templates; only data is passed from here.
 */
@Injectable()
export class DishesMailer {
  private readonly publicSiteUrl: string;

  constructor(
    private readonly brevo: BrevoService,
    config: ConfigService,
  ) {
    this.publicSiteUrl = config
      .get<string>('chefOnboarding.publicSiteUrl', 'https://labsfood.fr')
      .replace(/\/$/, '');
  }

  /** Where a batch cooker manages their dishes and menus. */
  private get recipesUrl(): string {
    return `${this.publicSiteUrl}/espace-chef/recettes`;
  }

  /**
   * A Lab's Food suggestion the chef adopted changed its allergens, diets or
   * country. Their copy is not changed for them (§6): they decide.
   */
  sourceChanged(input: { email: string; name?: string | null; dishName: string }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.sourceChanged,
      to: { email: input.email, name: input.name ?? undefined },
      label: 'source-changed',
      params: { dishName: input.dishName, recipesUrl: this.recipesUrl },
    });
  }

  /**
   * An admin took a dish or menu down (§4.3). `reason` is the admin's text,
   * shown as written. `menus` lists the published menus the dish drops out of.
   */
  contentSuspended(input: {
    email: string;
    name?: string | null;
    kind: 'dish' | 'menu';
    title: string;
    reason: string;
    reasonCode: string;
    menus?: string[];
  }) {
    return this.brevo.sendTemplate({
      templateId: this.brevo.templates.contentSuspended,
      to: { email: input.email, name: input.name ?? undefined },
      label: 'content-suspended',
      params: {
        kind: input.kind,
        title: input.title,
        reason: input.reason,
        reasonCode: input.reasonCode,
        menus: input.menus ?? [],
        recipesUrl: this.recipesUrl,
      },
    });
  }
}
