import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

/**
 * The Redis connection, when there is one.
 *
 * `REDIS_URL` is optional: callers check `configured` and keep an in-process
 * fallback, so local development and a single instance need no Redis. ioredis
 * reconnects on its own, so an outage is logged here and never thrown at boot.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly url?: string;
  private readonly connections: Redis[] = [];
  private client: Redis | null = null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('redisUrl');
    if (!this.url) {
      this.logger.warn(
        'Redis is not configured (REDIS_URL missing): in-process fallback.',
      );
    }
  }

  get configured(): boolean {
    return Boolean(this.url);
  }

  /** The shared connection for commands. */
  getClient(): Redis {
    // No offline queue: while Redis is down a command fails at once, and the
    // caller falls back, instead of waiting for a reconnection.
    this.client ??= this.connect('commands', { enableOfflineQueue: false });
    return this.client;
  }

  /**
   * A connection of its own. A connection that has subscribed can no longer send
   * commands, so pub/sub listeners must not use the shared one.
   */
  createSubscriber(): Redis {
    return this.connect('subscriber');
  }

  async ping(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      return (await this.getClient().ping()) === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  private connect(label: string, options: RedisOptions = {}): Redis {
    if (!this.url) {
      throw new Error('Redis is not configured.');
    }
    const connection = new Redis(this.url, { maxRetriesPerRequest: 2, ...options });
    // ioredis emits the same error on every retry: one line per distinct cause.
    let lastError = '';
    connection.on('error', (err) => {
      if (err.message === lastError) return;
      lastError = err.message;
      this.logger.error(`Redis (${label}) error: ${err.message}`);
    });
    connection.on('ready', () => {
      lastError = '';
      this.logger.log(`Redis (${label}) connected.`);
    });
    this.connections.push(connection);
    return connection;
  }
}
