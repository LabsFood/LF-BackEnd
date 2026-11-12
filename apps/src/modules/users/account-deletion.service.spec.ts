import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { UserRole } from '../../generated/prisma/client';
import { ClerkService } from '../../integrations/clerk.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';

const chef = {
  id: 'user-chef',
  clerkUserId: 'user_chef',
  role: UserRole.chef,
  deletedAt: null,
};
const admin = {
  id: 'user-admin',
  clerkUserId: 'user_admin',
  role: UserRole.admin,
  deletedAt: null,
};

describe('AccountDeletionService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; count: jest.Mock };
    booking: { findMany: jest.Mock };
  };
  let deleteUser: jest.Mock;
  let clerk: { configured: boolean; getClient: jest.Mock };
  let users: { findByClerkId: jest.Mock; deleteByClerkId: jest.Mock };
  let audit: { record: jest.Mock; failed: jest.Mock };
  let service: AccountDeletionService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(chef), count: jest.fn() },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    deleteUser = jest.fn().mockResolvedValue({});
    clerk = { configured: true, getClient: jest.fn(() => ({ users: { deleteUser } })) };
    users = {
      findByClerkId: jest.fn().mockResolvedValue(admin),
      deleteByClerkId: jest.fn().mockResolvedValue('anonymised'),
    };
    audit = { record: jest.fn(), failed: jest.fn() };
    service = new AccountDeletionService(
      prisma as unknown as PrismaService,
      clerk as unknown as ClerkService,
      users as unknown as UsersService,
      audit as unknown as AuditService,
    );
  });

  it('deletes Clerk first, then the row, and journals it', async () => {
    await expect(service.deleteByAdmin(chef.id, 'user_admin')).resolves.toEqual({
      id: chef.id,
      outcome: 'anonymised',
    });
    expect(deleteUser).toHaveBeenCalledWith('user_chef');
    expect(users.deleteByClerkId).toHaveBeenCalledWith('user_chef');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorUserId: admin.id,
        action: 'user.deleted',
        subjectId: chef.id,
      }),
    );
  });

  it('journals a self-deletion without the actor id once the row is gone', async () => {
    users.findByClerkId.mockResolvedValue(chef);
    users.deleteByClerkId.mockResolvedValue('deleted');

    await service.deleteOwn('user_chef');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'chef', actorUserId: null, subjectId: chef.id }),
    );
  });

  it('refuses while bookings are open, listing them with the side held', async () => {
    const startsAt = new Date('2026-11-04T10:00:00.000Z');
    prisma.booking.findMany.mockResolvedValue([
      {
        id: 'b-1',
        reference: 'BK-1',
        status: 'confirmed',
        startsAt,
        clientId: 'someone',
      },
      { id: 'b-2', reference: null, status: 'pending', startsAt, clientId: chef.id },
    ]);

    const refusal = await service.deleteByAdmin(chef.id, 'user_admin').catch((e) => e);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect(refusal.getResponse()).toEqual({
      code: 'USER_HAS_OPEN_BOOKINGS',
      message: expect.any(String),
      bookings: [
        { id: 'b-1', reference: 'BK-1', status: 'confirmed', startsAt, role: 'chef' },
        { id: 'b-2', reference: null, status: 'pending', startsAt, role: 'client' },
      ],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        metadata: expect.objectContaining({ bookingIds: ['b-1', 'b-2'] }),
      }),
    );
    expect(deleteUser).not.toHaveBeenCalled();
    expect(users.deleteByClerkId).not.toHaveBeenCalled();
  });

  it('refuses to delete the last admin', async () => {
    prisma.user.count.mockResolvedValue(0);

    const refusal = await service.deleteOwn('user_admin').catch((e) => e);

    expect(refusal.getResponse()).toMatchObject({ code: 'LAST_ADMIN' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('carries on when Clerk already lost the account', async () => {
    deleteUser.mockRejectedValue({ status: 404 });
    await expect(service.deleteByAdmin(chef.id, 'user_admin')).resolves.toMatchObject({
      outcome: 'anonymised',
    });
    expect(users.deleteByClerkId).toHaveBeenCalledWith('user_chef');
  });

  it('changes nothing when Clerk fails', async () => {
    deleteUser.mockRejectedValue({ status: 500 });

    const refusal = await service.deleteByAdmin(chef.id, 'user_admin').catch((e) => e);

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(refusal.getResponse()).toMatchObject({ code: 'CLERK_DELETE_FAILED' });
    expect(users.deleteByClerkId).not.toHaveBeenCalled();
    expect(audit.failed).toHaveBeenCalled();
  });

  it('answers 404 for an account already deleted', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...chef, deletedAt: new Date() });
    await expect(service.deleteByAdmin(chef.id, 'user_admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
