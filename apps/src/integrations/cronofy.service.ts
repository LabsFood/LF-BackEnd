import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DAY_MS, parisToday, ymd } from '../common/paris-time';
import type { CronofyDataCenter } from '../config/config.loader';

/**
 * What the batch cooker is asked to share: when they are busy, and the right to
 * write and remove the events of their prestations. Listing calendars needs no
 * scope of its own.
 */
export const CRONOFY_SCOPES = 'read_free_busy create_event delete_event';

const TIMEOUT_MS = 10_000;

export interface CronofyTokens {
  access_token: string;
  refresh_token: string;
  /** Seconds. */
  expires_in: number;
  /** The Cronofy account id. */
  sub: string;
  linking_profile?: {
    provider_name?: string;
    profile_id?: string;
    profile_name?: string;
  };
}

export interface CronofyCalendar {
  calendar_id: string;
  calendar_name: string;
  calendar_readonly: boolean;
  calendar_deleted: boolean;
  calendar_primary: boolean;
  provider_name: string;
  profile_name: string;
}

export interface CronofyBusyBlock {
  start: string;
  end: string;
  free_busy_status: 'busy' | 'tentative' | 'free' | 'unknown';
}

export interface CronofyEvent {
  /** Ours: the booking id, so a second push updates the same event. */
  event_id: string;
  summary: string;
  description?: string;
  /** UTC instants, `2026-10-16T15:30:00Z`. */
  start: string;
  end: string;
  location?: { description: string };
}

/** A Cronofy answer other than 2xx. */
export class CronofyError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Cronofy answered ${status}: ${body.slice(0, 200)}`);
  }

  /** The batch cooker revoked the access, or it lapsed: they must connect again. */
  get invalidGrant(): boolean {
    return this.status === 400 && this.body.includes('invalid_grant');
  }
}

/**
 * Every call into Cronofy, the calendar bridge of the batch cooker agenda. Plain
 * `fetch`, as for Brevo: a handful of endpoints do not justify an SDK. Holds no
 * tokens: `CalendarConnectionService` stores them, sealed, and passes them in.
 */
@Injectable()
export class CronofyService {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly dataCenter: CronofyDataCenter;
  readonly redirectUri?: string;
  /** Seals the stored tokens and signs the OAuth `state`. */
  readonly tokenKey?: Buffer;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('cronofy.clientId');
    this.clientSecret = config.get<string>('cronofy.clientSecret');
    this.dataCenter = config.get<CronofyDataCenter>('cronofy.dataCenter', 'de');
    this.redirectUri = config.get<string>('cronofy.redirectUri');
    const key = config.get<string>('cronofy.tokenKey');
    this.tokenKey = key ? Buffer.from(key, 'base64') : undefined;
  }

  get configured(): boolean {
    return Boolean(
      this.clientId &&
      this.clientSecret &&
      this.redirectUri &&
      this.tokenKey?.length === 32,
    );
  }

  /** The API host of the data center the Cronofy application lives in. */
  get apiUrl(): string {
    return `https://api-${this.dataCenter}.cronofy.com`;
  }

  /** Where the batch cooker is sent to agree. */
  get appUrl(): string {
    return `https://app-${this.dataCenter}.cronofy.com`;
  }

  authorizeUrl(state: string): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId ?? '',
      redirect_uri: this.redirectUri ?? '',
      scope: CRONOFY_SCOPES,
      state,
    });
    return `${this.appUrl}/oauth/authorize?${query}`;
  }

  exchangeCode(code: string): Promise<CronofyTokens> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
  }

  /** Cronofy may rotate the refresh token: keep the one it answers with. */
  refresh(refreshToken: string): Promise<CronofyTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token: string): Promise<void> {
    await this.call('POST', '/oauth/token/revoke', {
      body: { client_id: this.clientId, client_secret: this.clientSecret, token },
    });
  }

  async listCalendars(accessToken: string): Promise<CronofyCalendar[]> {
    const page = await this.call<{ calendars: CronofyCalendar[] }>(
      'GET',
      '/v1/calendars',
      {
        token: accessToken,
      },
    );
    return page.calendars ?? [];
  }

  /**
   * Busy blocks between two instants, all pages. Cronofy takes whole Paris days
   * (`to` excluded), so the caller trims. Events this API wrote ("managed") are
   * left out by Cronofy: the bookings behind them are counted from the database.
   */
  async freeBusy(accessToken: string, from: Date, to: Date): Promise<CronofyBusyBlock[]> {
    const query = new URLSearchParams({
      tzid: 'Europe/Paris',
      from: ymd(parisToday(from)),
      to: ymd(new Date(parisToday(to).getTime() + DAY_MS)),
    });
    const blocks: CronofyBusyBlock[] = [];
    let url: string | undefined = `${this.apiUrl}/v1/free_busy?${query}`;
    while (url) {
      const page: {
        free_busy?: CronofyBusyBlock[];
        pages?: { next_page?: string };
      } = await this.call('GET', url, { token: accessToken });
      blocks.push(...(page.free_busy ?? []));
      url = page.pages?.next_page;
    }
    return blocks;
  }

  /** Creates the event, or updates it: Cronofy keys it on `event_id`. */
  async upsertEvent(
    accessToken: string,
    calendarId: string,
    event: CronofyEvent,
  ): Promise<void> {
    await this.call('POST', `/v1/calendars/${encodeURIComponent(calendarId)}/events`, {
      token: accessToken,
      body: { ...event, tzid: 'Europe/Paris' },
    });
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string) {
    await this.call('DELETE', `/v1/calendars/${encodeURIComponent(calendarId)}/events`, {
      token: accessToken,
      body: { event_id: eventId },
    });
  }

  private token(body: Record<string, unknown>): Promise<CronofyTokens> {
    return this.call('POST', '/oauth/token', {
      body: { client_id: this.clientId, client_secret: this.clientSecret, ...body },
    });
  }

  /** `path` may be a full URL, from Cronofy's own paging only. */
  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { token?: string; body?: unknown },
  ): Promise<T> {
    const url = path.startsWith('https://') ? path : `${this.apiUrl}${path}`;
    if (!url.startsWith(`${this.apiUrl}/`)) {
      throw new Error(`Refusing to call ${url} outside the Cronofy API.`);
    }
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new CronofyError(response.status, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
