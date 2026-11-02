import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CONSENT_WITHDRAWN, toDeclaration } from './domain/allergies.rules';
import { DeclareAllergiesDto } from './dto/allergies.dto';

/**
 * The client's allergy declaration (Recettes lot 1). Logs carry counts and ids,
 * never an allergy.
 */
@Injectable()
export class AllergiesService {
  private readonly logger = new Logger(AllergiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** `PUT /me/profile/allergies`. Creates the client profile when there is none yet. */
  async declare(clerkUserId: string, dto: DeclareAllergiesDto) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    await this.users.assertNoConflictingProfile(user.id, 'client');
    const data = toDeclaration(dto, new Date());
    const after = await this.prisma.clientProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    });
    this.logger.log({
      event: 'client.allergies_declared',
      clientProfileId: after.id,
      none: after.allergiesNone,
      count: after.allergies.length + after.customAllergies.length,
    });
    return this.users.getProfileByClerkUserId(clerkUserId);
  }

  /** `DELETE /me/profile/health-consent`: the allergies go with it, and the question comes back. */
  async withdraw(clerkUserId: string) {
    const user = await this.users.ensurePersistedFromClerk(clerkUserId);
    const { count } = await this.prisma.clientProfile.updateMany({
      where: { userId: user.id },
      data: CONSENT_WITHDRAWN,
    });
    this.logger.log({ event: 'client.health_consent_withdrawn', userId: user.id, count });
    return this.users.getProfileByClerkUserId(clerkUserId);
  }
}
