import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { stackOf } from '../../common/logging/app-logger';
import { User, UserRole } from '../../generated/prisma/client';
import { ClerkService } from '../../integrations/clerk.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HOLDS_SLOT } from '../bookings/domain/booking-status';
import type {
  BlockingBookingDto,
  DeletedUserDto,
  DeleteUserRefusedDto,
} from './dto/account-deletion.dto';
import { UsersService } from './users.service';

/** Who asked: the person themselves, or an admin. Audit rows record a `users.id`. */
interface Deleter {
  actorType: UserRole;
  actorUserId: string;
}

/**
 * Deleting an account of any role, by its owner or by an admin.
 *
 * Refused while a booking of theirs is not completed nor cancelled, and for the last
 * admin. Otherwise Clerk's account goes first, then `UsersService.deleteByClerkId`
 * deletes or anonymises the row, the same cleanup as Clerk's `user.deleted` webhook.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /** `DELETE /me`. */
  async deleteOwn(clerkUserId: string): Promise<DeletedUserDto> {
    const user = await this.users.findByClerkId(clerkUserId);
    return this.delete(user, user && { actorType: user.role, actorUserId: user.id });
  }

  /** `DELETE /admin/users/:id`. */
  async deleteByAdmin(userId: string, adminClerkUserId: string): Promise<DeletedUserDto> {
    const [user, admin] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.users.findByClerkId(adminClerkUserId),
    ]);
    // AdminGuard has just read the admin's row.
    return this.delete(user, { actorType: UserRole.admin, actorUserId: admin!.id });
  }

  private async delete(user: User | null, by: Deleter | null): Promise<DeletedUserDto> {
    if (!user || user.deletedAt || !by) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No account with this id.',
      });
    }
    await this.assertNotLastAdmin(user, by);
    await this.assertNoOpenBookings(user, by);
    await this.deleteClerkAccount(user, by);

    let outcome: DeletedUserDto['outcome'];
    try {
      outcome = await this.users.deleteByClerkId(user.clerkUserId);
    } catch (error) {
      // Clerk's account is already gone: its `user.deleted` webhook, which Svix
      // retries, runs this same cleanup again.
      this.logger.error(
        {
          event: 'user.delete_cleanup_failed',
          userId: user.id,
          actorUserId: by.actorUserId,
        },
        stackOf(error),
      );
      await this.audit.failed(this.entry(user, by, { stage: 'database' }), error);
      throw error;
    }

    this.logger.log({
      event: 'user.deleted',
      userId: user.id,
      role: user.role,
      outcome,
      actorUserId: by.actorUserId,
      self: by.actorUserId === user.id,
    });
    await this.audit.record(this.entry(user, by, { outcome }));
    return { id: user.id, outcome };
  }

  private async assertNotLastAdmin(user: User, by: Deleter): Promise<void> {
    if (user.role !== UserRole.admin) return;
    const otherAdmins = await this.prisma.user.count({
      where: { role: UserRole.admin, deletedAt: null, id: { not: user.id } },
    });
    if (otherAdmins > 0) return;
    await this.refuse(user, by, {
      code: 'LAST_ADMIN',
      message: 'This is the last admin. Make someone else admin first.',
    });
  }

  /**
   * As client or as batch cooker, every booking still holding a slot (`HOLDS_SLOT`:
   * not completed nor cancelled) blocks: its payment, payout or dispute needs both
   * parties. The list goes back to the caller so the dashboard can show what to settle.
   *
   * ponytail: checked, not locked, so a booking created in the instant between this
   * read and the deletion is not seen. The deleted row then stays anonymised under it.
   */
  private async assertNoOpenBookings(user: User, by: Deleter): Promise<void> {
    const open = await this.prisma.booking.findMany({
      where: {
        status: { in: [...HOLDS_SLOT] },
        OR: [{ clientId: user.id }, { chefProfile: { userId: user.id } }],
      },
      select: { id: true, reference: true, status: true, startsAt: true, clientId: true },
      orderBy: { startsAt: 'asc' },
    });
    if (open.length === 0) return;

    const bookings: BlockingBookingDto[] = open.map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      startsAt: booking.startsAt,
      role: booking.clientId === user.id ? 'client' : 'chef',
    }));
    await this.refuse(
      user,
      by,
      {
        code: 'USER_HAS_OPEN_BOOKINGS',
        message: 'Cancel or complete these bookings before deleting the account.',
        bookings,
      },
      { bookingIds: bookings.map((booking) => booking.id) },
    );
  }

  private async deleteClerkAccount(user: User, by: Deleter): Promise<void> {
    if (!this.clerk.configured) {
      throw new ServiceUnavailableException({
        code: 'CLERK_NOT_CONFIGURED',
        message: 'The server has no Clerk key, so it cannot delete accounts.',
      });
    }
    try {
      await this.clerk.getClient().users.deleteUser(user.clerkUserId);
    } catch (error) {
      // Already deleted from Clerk's dashboard, its webhook not landed yet: carry on.
      if ((error as { status?: number } | null)?.status === 404) return;
      this.logger.error(
        {
          event: 'user.delete_clerk_failed',
          userId: user.id,
          actorUserId: by.actorUserId,
        },
        stackOf(error),
      );
      await this.audit.failed(this.entry(user, by, { stage: 'clerk' }), error);
      throw new ServiceUnavailableException({
        code: 'CLERK_DELETE_FAILED',
        message: 'Clerk could not delete the account. Nothing was changed; try again.',
      });
    }
  }

  /** Logs, journals and answers a refusal (409). */
  private async refuse(
    user: User,
    by: Deleter,
    body: Omit<DeleteUserRefusedDto, 'requestId'>,
    logged: Record<string, unknown> = {},
  ): Promise<never> {
    this.logger.warn({
      event: 'user.delete_refused',
      code: body.code,
      userId: user.id,
      role: user.role,
      actorUserId: by.actorUserId,
      ...logged,
    });
    await this.audit.record({
      ...this.entry(user, by, { code: body.code, ...logged }),
      outcome: 'failed',
    });
    throw new ConflictException(body);
  }

  private entry(user: User, by: Deleter, metadata: Record<string, unknown>) {
    return {
      actorType: by.actorType,
      actorUserId: by.actorUserId,
      action: 'user.deleted',
      subjectType: 'user',
      subjectId: user.id,
      metadata: { role: user.role, ...metadata },
    };
  }
}
