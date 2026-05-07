import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User, UserRole } from '../../database/entities';

export interface UpsertFromClerkInput {
  clerkUserId: string;
  email?: string;
  fullName?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findByClerkId(clerkUserId: string): Promise<User | null> {
    return this.users.findOne({ where: { clerkUserId } });
  }

  /** Get-or-create a `users` row keyed by Clerk subject. */
  async upsertFromClerk(input: UpsertFromClerkInput): Promise<User> {
    const existing = await this.findByClerkId(input.clerkUserId);
    if (existing) {
      let dirty = false;
      if (input.email && existing.email !== input.email) {
        existing.email = input.email;
        dirty = true;
      }
      if (input.fullName !== undefined && existing.fullName !== input.fullName) {
        existing.fullName = input.fullName ?? null;
        dirty = true;
      }
      if (dirty) {
        return this.users.save(existing);
      }
      return existing;
    }
    const created = this.users.create({
      clerkUserId: input.clerkUserId,
      email: input.email ?? `${input.clerkUserId}@unknown.invalid`,
      fullName: input.fullName ?? null,
      role: UserRole.CLIENT,
    });
    return this.users.save(created);
  }
}
