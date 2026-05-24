import { Prisma } from '@prisma/client';

/** Serialize typed objects into Prisma `Json` / `InputJsonValue` fields. */
export const toInputJson = <T>(value: T): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
