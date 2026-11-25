import 'reflect-metadata';

import { ParseVersionPipe } from '../../common/pipes/version-param.pipe';
import { MeContentController } from './me-content.controller';

const USER = { userId: 'user-1' } as never;
const DISH = '0d7c1c7a-3f5b-4d8e-9a1c-2b4e6f8a0c11';

function build() {
  const versions = {
    restore: jest.fn(async () => ({ ok: true })),
    get: jest.fn(async () => ({})),
  };
  const dishes = { confirmAllergens: jest.fn(async () => ({ ok: true })) };
  const controller = new MeContentController(
    dishes as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    versions as never,
  );
  return { controller, versions, dishes };
}

/** The pipes Nest runs on each parameter of a route handler. */
function pipesOf(method: string): unknown[] {
  const args = Reflect.getMetadata(
    '__routeArguments__',
    MeContentController,
    method,
  ) as Record<string, { data?: string; pipes: unknown[] }>;
  return Object.values(args)
    .filter((arg) => arg.data === 'version')
    .flatMap((arg) => arg.pipes);
}

describe('MeContentController optional bodies (Task 20A)', () => {
  it('restores a version when the request has no body at all', async () => {
    const { controller, versions } = build();
    await expect(
      controller.restoreVersion(USER, DISH, 2, undefined as never),
    ).resolves.toEqual({ ok: true });
    expect(versions.restore).toHaveBeenCalledWith('user-1', DISH, 2, undefined);
  });

  it('confirms the allergens when the request has no body at all', async () => {
    const { controller, dishes } = build();
    await expect(
      controller.confirmDishAllergens(USER, DISH, undefined as never),
    ).resolves.toEqual({ ok: true });
    expect(dishes.confirmAllergens).toHaveBeenCalledWith('user-1', DISH, undefined);
  });

  it('bounds :version on the read and on the restore', () => {
    for (const method of ['getVersion', 'restoreVersion']) {
      const pipes = pipesOf(method);
      expect(pipes).toHaveLength(1);
      expect(pipes[0]).toBe(ParseVersionPipe);
    }
  });
});
