import { Injectable, NotFoundException } from '@nestjs/common';

import { ChefApplication, ChefProfile, Meal } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isDisabledByAdmin,
  toWire,
} from '../chef-onboarding/domain/chef-onboarding.rules';
import { ChefDocumentsService } from '../chef-onboarding/services/chef-documents.service';
import { chefNotVerified, contentNotOwned } from './domain/content.errors';

export type ChefContext = ChefProfile & { application: ChefApplication | null };

/**
 * Who the calling batch cooker is, and what they may do with a given dish or menu.
 * Every chef route goes through here, so the FLOW-02 §8 access rule lives in one
 * place: another chef's content is missing on a read and `403 CONTENT_NOT_OWNED`
 * on a write.
 */
@Injectable()
export class ChefContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ChefDocumentsService,
  ) {}

  async chef(clerkUserId: string): Promise<ChefContext> {
    const profile = await this.prisma.chefProfile.findFirst({
      where: { user: { clerkUserId } },
      include: { application: true },
    });
    if (!profile) {
      throw new NotFoundException('No batch cooker profile for this account.');
    }
    return profile;
  }

  /** Browse-only until the candidature is approved (FLOW-01). */
  assertVerified(chef: ChefContext): void {
    if (!chef.isVerified) {
      throw chefNotVerified(
        'Your candidature must be approved before you can write dishes or menus.',
      );
    }
  }

  /**
   * §3.3: publishing needs an approved chef **and** a dossier validated right now,
   * so a chef whose blocking document expired cannot put anything new online.
   */
  async assertCanPublish(chef: ChefContext): Promise<void> {
    this.assertVerified(chef);
    const status = chef.application
      ? this.documents.deriveStatus(
          await this.documents.latestPerType(chef.id),
          this.documents.answersOf(chef.application),
          isDisabledByAdmin(chef),
        )
      : 'draft';
    if (status !== 'validated') {
      throw chefNotVerified(
        `Your dossier must be validated to publish; it is \`${toWire(status)}\`.`,
      );
    }
  }

  /** One of the chef's dishes. Someone else's is reported missing, never revealed. */
  async readableDish(chef: ChefContext, id: string): Promise<Meal> {
    const dish = await this.prisma.meal.findUnique({ where: { id } });
    if (!dish || dish.chefProfileId !== chef.id) {
      throw new NotFoundException('Dish not found.');
    }
    return dish;
  }

  /** One of the chef's dishes, about to be changed: §8 answers 403 for another's. */
  async writableDish(chef: ChefContext, id: string): Promise<Meal> {
    const dish = await this.prisma.meal.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Dish not found.');
    if (dish.chefProfileId !== chef.id) {
      throw contentNotOwned('This dish is not yours.');
    }
    return dish;
  }
}
