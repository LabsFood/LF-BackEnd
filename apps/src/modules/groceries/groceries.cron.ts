import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';

import { stackOf } from '../../common/logging/app-logger';
import { GroceriesService } from './groceries.service';

/**
 * Recettes lot 6: the clock of the groceries, every 5 minutes. Each step is claimed by
 * an UPDATE in the service, so two replicas or a restart never run one twice: the runs
 * of accepted prestations, the hold at the lock, the cancel deadline, the stale runs, the captures, the settlement.
 */
@Injectable()
export class GroceriesCron {
  private readonly logger = new Logger(GroceriesCron.name);

  constructor(private readonly groceries: GroceriesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'groceries-clock' })
  @SentryCron('groceries-clock', {
    checkinMargin: 5,
    maxRuntime: 5,
    failureIssueThreshold: 3,
  })
  async run(now: Date = new Date()) {
    const started = Date.now();
    const done: Record<string, number> = {};
    for (const [step, work] of [
      ['opened', () => this.groceries.openDueRuns(now)],
      ['holds', () => this.groceries.placeDueHolds(now)],
      ['deadlines', () => this.groceries.handleDeadlines(now)],
      ['closed', () => this.groceries.closeStaleRuns(now)],
      ['captured', () => this.groceries.captureDue(now)],
      ['settled', () => this.groceries.settleDue(now)],
    ] as const) {
      try {
        done[step] = await work();
      } catch (error) {
        // One step failing never stops the others: each is retried next run.
        done[step] = -1;
        this.logger.error({ event: 'job.groceries_step_failed', step }, stackOf(error));
      }
    }
    this.logger.log({ event: 'job.groceries', ...done, ms: Date.now() - started });
    return done;
  }
}
