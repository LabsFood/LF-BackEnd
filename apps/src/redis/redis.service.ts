// Redis not implemented yet — uncomment when cache/queues are wired.
//
// import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import Redis from 'ioredis';
//
// @Injectable()
// export class RedisService implements OnModuleInit, OnModuleDestroy {
//   private readonly logger = new Logger(RedisService.name);
//   private client: Redis | null = null;
//
//   constructor(private readonly config: ConfigService) {}
//
//   async onModuleInit(): Promise<void> {
//     const url = this.config.getOrThrow<string>('redisUrl');
//     this.client = new Redis(url, {
//       lazyConnect: true,
//       maxRetriesPerRequest: 3,
//       enableReadyCheck: true,
//     });
//     this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
//     try {
//       await this.client.connect();
//       this.logger.log(`Connected to Redis at ${url}`);
//     } catch (err) {
//       this.logger.error(
//         `Failed to connect to Redis at ${url}: ${(err as Error).message}`,
//       );
//       throw err;
//     }
//   }
//
//   async onModuleDestroy(): Promise<void> {
//     if (this.client) {
//       await this.client.quit();
//       this.client = null;
//     }
//   }
//
//   getClient(): Redis {
//     if (!this.client) {
//       throw new Error('Redis client is not initialised yet.');
//     }
//     return this.client;
//   }
//
//   async ping(): Promise<boolean> {
//     try {
//       const reply = await this.getClient().ping();
//       return reply === 'PONG';
//     } catch (err) {
//       this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
//       return false;
//     }
//   }
// }

export {};
