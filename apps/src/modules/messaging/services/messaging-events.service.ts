import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';

import { RedisService } from '../../../redis/redis.service';
import type { RealtimeEnvelope } from '../messaging.types';

const CHANNEL = 'messaging:events';

type Listener = (envelope: RealtimeEnvelope) => void;

/**
 * Carries what happened in a conversation to every API instance.
 *
 * A WebSocket lives on one instance; the message may be posted on another. Each
 * instance publishes to one Redis channel and delivers what it hears to its own
 * sockets. Without Redis there is one instance, and delivery is a direct call.
 *
 * Best-effort by design: the message is already stored, so a lost event costs the
 * recipient a refresh, never a message.
 */
@Injectable()
export class MessagingEventsService implements OnModuleInit {
  private readonly logger = new Logger(MessagingEventsService.name);
  private readonly listeners = new Set<Listener>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    if (!this.redis.configured) return;
    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('message', (_channel, raw) => {
      try {
        this.deliver(JSON.parse(raw) as RealtimeEnvelope);
      } catch (err) {
        this.logger.warn(`Dropped an unreadable event: ${(err as Error).message}`);
      }
    });
    // ioredis re-subscribes by itself after a reconnection.
    this.subscriber.subscribe(CHANNEL).catch((err: Error) => {
      this.logger.error(`Could not subscribe to ${CHANNEL}: ${err.message}`);
    });
  }

  /** The gateway registers here to push events down its sockets. */
  onEvent(listener: Listener): void {
    this.listeners.add(listener);
  }

  async publish(envelope: RealtimeEnvelope): Promise<void> {
    if (this.redis.configured) {
      try {
        await this.redis.getClient().publish(CHANNEL, JSON.stringify(envelope));
        return;
      } catch (err) {
        // Redis is down: this instance's own sockets still get the event.
        this.logger.warn(
          `Publish fell back to local delivery: ${(err as Error).message}`,
        );
      }
    }
    // Through JSON as over Redis, so listeners always receive the same shape
    // (dates as strings) whichever path the event took.
    this.deliver(JSON.parse(JSON.stringify(envelope)) as RealtimeEnvelope);
  }

  private deliver(envelope: RealtimeEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch (err) {
        this.logger.warn(`An event listener failed: ${(err as Error).message}`);
      }
    }
  }
}
