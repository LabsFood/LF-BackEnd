import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../redis/redis.service';
import { SEND_RATE_LIMIT } from '../domain/messaging.rules';

/**
 * Caps how fast one person can send, across all their conversations.
 *
 * A fixed window counted in Redis, so the cap holds across instances. Without
 * Redis, or while it is unreachable, the count stays in this process: a weaker
 * cap is better than refusing every message because Redis is down.
 */
@Injectable()
export class MessagingRateLimiter {
  private readonly logger = new Logger(MessagingRateLimiter.name);
  private readonly local = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertCanSend(userId: string): Promise<void> {
    const count = await this.increment(userId);
    if (count > SEND_RATE_LIMIT.limit) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `No more than ${SEND_RATE_LIMIT.limit} messages per minute.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async increment(userId: string): Promise<number> {
    if (this.redis.configured) {
      try {
        const key = `messaging:send:${userId}`;
        const client = this.redis.getClient();
        const count = await client.incr(key);
        if (count === 1) await client.expire(key, SEND_RATE_LIMIT.windowSeconds);
        return count;
      } catch (err) {
        this.logger.warn(`Rate limit fell back to memory: ${(err as Error).message}`);
      }
    }
    return this.incrementLocal(userId);
  }

  private incrementLocal(userId: string): number {
    const now = Date.now();
    const entry = this.local.get(userId);
    if (!entry || entry.resetAt <= now) {
      // Each expired entry is replaced on that person's next send; sweeping the
      // others here keeps the map from growing with people who left.
      if (this.local.size > 5000) {
        for (const [key, value] of this.local) {
          if (value.resetAt <= now) this.local.delete(key);
        }
      }
      this.local.set(userId, {
        count: 1,
        resetAt: now + SEND_RATE_LIMIT.windowSeconds * 1000,
      });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}
