import { PublishProblem, readiness, ReadinessDish } from './dishes.rules';

/** `YYYY-MM-DD` that is a real calendar day and a Monday (§3.5). */
export function isMonday(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(day) &&
    date.getUTCDay() === 1
  );
}

/** A dish as menu publication needs it. */
export interface MenuDishState extends ReadinessDish {
  id: string;
  status: string;
}

export interface MenuPublishProblems {
  /** Problems of the menu itself: an empty title, no dish. */
  menu: PublishProblem[];
  /** Each dish that stops the menu, with its own reasons. */
  dishes: { dishId: string; name: string; problems: PublishProblem[] }[];
}

/**
 * §3.4, with the PRD's rule that publishing a menu publishes its draft dishes: the
 * menu needs a title and a dish, no dish may be suspended, and every draft dish
 * must pass the same checks as if it were published on its own (Recettes §4.11,
 * R3). All or nothing, so everything that fails is reported at once.
 */
export function menuPublishProblems(
  menu: { title: string },
  dishes: MenuDishState[],
): MenuPublishProblems {
  const result: MenuPublishProblems = { menu: [], dishes: [] };
  if (!menu.title.trim()) {
    result.menu.push({
      code: 'VALIDATION_FAILED',
      field: 'title',
      message: 'The title is empty.',
    });
  }
  if (dishes.length === 0) {
    result.menu.push({
      code: 'VALIDATION_FAILED',
      field: 'dishIds',
      message: 'A menu holds at least one dish.',
    });
  }
  for (const dish of dishes) {
    const problems =
      dish.status === 'suspended'
        ? [
            {
              code: 'VALIDATION_FAILED' as const,
              field: 'status',
              message:
                'This dish was taken down by an admin. Correct and republish it, or ' +
                'remove it from the menu.',
            },
          ]
        : dish.status === 'published'
          ? []
          : publicationProblems(dish);
    if (problems.length)
      result.dishes.push({ dishId: dish.id, name: dish.name, problems });
  }
  return result;
}

export const hasMenuProblems = (problems: MenuPublishProblems) =>
  problems.menu.length > 0 || problems.dishes.length > 0;

/** What publishing a dish needs: "Prête", plus what publication adds (§4.11). */
export function publicationProblems(dish: ReadinessDish): PublishProblem[] {
  const { problems, toPublish } = readiness(dish);
  return [...problems, ...toPublish];
}
