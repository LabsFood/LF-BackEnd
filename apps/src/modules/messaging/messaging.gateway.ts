import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';

import { resolveClerkUser } from '../../auth/clerk-auth.guard';
import { UserRole } from '../../generated/prisma/client';
import { UsersService } from '../users/users.service';
import type { RealtimeEnvelope, RealtimeEvent } from './messaging.types';
import { MessagingEventsService } from './services/messaging-events.service';

/** A socket that has not said who it is by then is closed. */
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
/**
 * A socket is trusted from its handshake on, while a Clerk token lives a minute.
 * Closing it every hour makes the browser come back with a fresh token, so a
 * revoked session stops receiving within the hour.
 */
const MAX_SOCKET_AGE_MS = 60 * 60 * 1000;

/** Application close codes (4000–4999 are free for applications). */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_REAUTHENTICATE = 4408;

interface SocketState {
  userId?: string;
  isAdmin: boolean;
  alive: boolean;
  openedAt: number;
  authTimer?: NodeJS.Timeout;
}

/**
 * Pushes what happens in conversations to the people concerned. Listen-only:
 * messages are sent through the REST API, never through the socket.
 *
 * A browser cannot set an `Authorization` header on a WebSocket, so the first
 * frame carries the Clerk token: `{"event":"auth","data":{"token":"…"}}`, answered
 * by `{"event":"ready"}`. There is nothing to subscribe to: the server decides
 * what each person receives from who they are, so knowing a conversation id gives
 * access to nothing.
 */
@WebSocketGateway({ path: '/ws', maxPayload: 16 * 1024 })
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MessagingGateway.name);
  private readonly states = new Map<WebSocket, SocketState>();
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private readonly admins = new Set<WebSocket>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly events: MessagingEventsService,
  ) {}

  onModuleInit(): void {
    this.events.onEvent((envelope) => this.deliver(envelope));
    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS);
    // Never the reason the process stays up.
    this.heartbeat.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const [client, state] of this.states) {
      clearTimeout(state.authTimer);
      client.terminate();
    }
  }

  handleConnection(client: WebSocket): void {
    const state: SocketState = { isAdmin: false, alive: true, openedAt: Date.now() };
    state.authTimer = setTimeout(
      () => client.close(CLOSE_UNAUTHORIZED, 'auth timeout'),
      AUTH_TIMEOUT_MS,
    );
    this.states.set(client, state);
    client.on('pong', () => {
      state.alive = true;
    });
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.states.get(client);
    if (!state) return;
    clearTimeout(state.authTimer);
    this.states.delete(client);
    this.admins.delete(client);
    if (state.userId) {
      const sockets = this.byUser.get(state.userId);
      sockets?.delete(client);
      if (sockets?.size === 0) this.byUser.delete(state.userId);
    }
  }

  @SubscribeMessage('auth')
  async authenticate(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { token?: unknown } | undefined,
  ): Promise<{ event: 'ready'; data: Record<string, never> } | undefined> {
    const state = this.states.get(client);
    if (!state || state.userId) return undefined;

    try {
      if (typeof data?.token !== 'string') throw new Error('no token');
      const clerkUser = await resolveClerkUser(data.token, this.config);
      const user = await this.users.findByClerkId(clerkUser.userId);
      if (!user || user.deletedAt) throw new Error('unknown user');

      clearTimeout(state.authTimer);
      state.userId = user.id;
      state.isAdmin = user.role === UserRole.admin;
      if (state.isAdmin) {
        this.admins.add(client);
      } else {
        const sockets = this.byUser.get(user.id) ?? new Set<WebSocket>();
        sockets.add(client);
        this.byUser.set(user.id, sockets);
      }
      return { event: 'ready', data: {} };
    } catch {
      client.close(CLOSE_UNAUTHORIZED, 'unauthorized');
      return undefined;
    }
  }

  private deliver(envelope: RealtimeEnvelope): void {
    if (envelope.toUsers) {
      for (const userId of envelope.userIds) {
        for (const client of this.byUser.get(userId) ?? []) {
          this.send(client, envelope.toUsers);
        }
      }
    }
    if (envelope.toAdmins) {
      for (const client of this.admins) this.send(client, envelope.toAdmins);
    }
  }

  private send(client: WebSocket, event: RealtimeEvent): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(event), (err) => {
      if (err) this.logger.debug(`Send failed, socket dropped: ${err.message}`);
    });
  }

  /** Drops sockets whose browser is gone, and retires the ones that are too old. */
  private sweep(): void {
    const now = Date.now();
    for (const [client, state] of this.states) {
      if (!state.alive) {
        client.terminate();
        continue;
      }
      if (now - state.openedAt > MAX_SOCKET_AGE_MS) {
        client.close(CLOSE_REAUTHENTICATE, 'reauthenticate');
        continue;
      }
      state.alive = false;
      client.ping();
    }
  }
}
