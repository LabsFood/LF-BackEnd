import { ParseUUIDPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { ChefIngredientsService } from './chef-ingredients.service';
import { MeIngredientsController } from './me-ingredients.controller';

function harness() {
  const service = {
    create: jest.fn(async (..._a: unknown[]) => ({ id: 'ing-1' })),
    listMine: jest.fn(async (..._a: unknown[]) => [{ id: 'ing-1' }]),
    update: jest.fn(async (..._a: unknown[]) => ({ id: 'ing-1' })),
  };
  const controller = new MeIngredientsController(
    service as unknown as ChefIngredientsService,
  );
  return { service, controller };
}

const user = { userId: 'clerk-1' } as never;

describe('MeIngredientsController (Recettes §7.1)', () => {
  it('passes the signed-in chef to the service', async () => {
    const { service, controller } = harness();
    const dto = { name: 'Harissa maison', aisle: 'epicerie', allergensNone: true };

    await controller.create(user, dto);
    await controller.list(user);
    await controller.update(user, 'ing-1', { name: 'Harissa' });

    expect(service.create).toHaveBeenCalledWith('clerk-1', dto);
    expect(service.listMine).toHaveBeenCalledWith('clerk-1');
    expect(service.update).toHaveBeenCalledWith('clerk-1', 'ing-1', { name: 'Harissa' });
  });

  it('is behind the Clerk guard, and the update takes a UUID only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MeIngredientsController)).toEqual([
      ClerkAuthGuard,
    ]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      MeIngredientsController,
      'update',
    ) as Record<string, { data?: string; pipes: unknown[] }>;
    const id = Object.values(args).find((arg) => arg.data === 'id');
    expect(id?.pipes).toEqual([ParseUUIDPipe]);
  });
});
