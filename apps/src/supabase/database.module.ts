import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

/** Persistence entry point — Prisma replaces former TypeORM `DatabaseModule`. */
@Module({
  imports: [PrismaModule],
  exports: [PrismaModule],
})
export class DatabaseModule {}
