import { Injectable, MessageEvent } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import Redis from 'ioredis';
import { Observable } from 'rxjs';

const REPLAY_TTL_SECONDS = 15 * 60;
const MAX_REPLAY_EVENTS = 512;
const GENERATION_DURATION_MS = 6 * 60 * 60 * 1000;
const DATA_ENCODING = 'json-v1';

const PUBLISH_SCRIPT = `
local latest = redis.call('LINDEX', KEYS[1], 0)
if latest then
  local parsed, previous = pcall(cjson.decode, latest)
  if parsed and type(previous) == 'table' and previous.fingerprint == ARGV[1] then return latest end
end
local sequence = redis.call('INCR', KEYS[2])
local event = cjson.decode(ARGV[2])
event.id = ARGV[3] .. tostring(sequence)
event.fingerprint = ARGV[1]
local stored = cjson.encode(event)
redis.call('LPUSH', KEYS[1], stored)
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[4]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
return stored
`;

interface StoredSseEvent {
  id: string;
  data: string | object;
  dataEncoding?: typeof DATA_ENCODING | 'text-v1';
  fingerprint: string;
  retry?: number;
  type?: string;
}

@Injectable()
export class SseReplayService {
  private readonly cursorSecret = this.readCursorSecret();

  constructor(private readonly redis: Redis) {}

  scope(channel: string, id: string): string {
    const digest = createHmac('sha256', this.cursorSecret)
      .update(JSON.stringify([channel, id]))
      .digest('base64url')
      .slice(0, 22);
    return `${channel}:${digest}`;
  }

  replay(scope: string, lastEventId: string | undefined, source: Observable<MessageEvent>): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      let replayFinished = false;
      let lastDeliveredId = lastEventId;
      const buffered: StoredSseEvent[] = [];
      const deliver = (event: StoredSseEvent) => {
        if (event.id !== lastDeliveredId) {
          lastDeliveredId = event.id;
          subscriber.next(this.toMessageEvent(event));
        }
      };
      const sourceSubscription = source.subscribe({
        next: (event) => {
          if (event.id) {
            const stored = this.fromMessageEvent(event, event.id);
            if (replayFinished) deliver(stored);
            else buffered.push(stored);
          } else {
            subscriber.next(event);
          }
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      void this.readReplay(scope, lastEventId).then((events) => {
        events.forEach(deliver);
        replayFinished = true;
        buffered.forEach(deliver);
      }).catch((error: unknown) => subscriber.error(error));

      return () => sourceSubscription.unsubscribe();
    });
  }

  async record(scope: string, event: MessageEvent): Promise<MessageEvent> {
    const serialized = typeof event.data === 'string'
      ? { data: event.data, dataEncoding: 'text-v1' as const }
      : { data: JSON.stringify(event.data) ?? 'null', dataEncoding: DATA_ENCODING };
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...serialized, retry: event.retry ?? 3_000, type: event.type })).digest('base64url');
    const generation = Math.floor(Date.now() / GENERATION_DURATION_MS).toString(36);
    const stored = await this.redis.eval(
      PUBLISH_SCRIPT,
      2,
      this.eventsKey(scope),
      `sse-replay:v1:${scope}:sequence:${generation}`,
      fingerprint,
      JSON.stringify({ ...serialized, retry: event.retry ?? 3_000, type: event.type }),
      `sse1.${this.scopeTag(scope)}.${generation}.`,
      String(MAX_REPLAY_EVENTS),
      String(REPLAY_TTL_SECONDS),
    );
    const parsed = typeof stored === 'string' ? this.parse(stored) : null;
    if (!parsed) throw new Error('Unexpected Redis SSE replay response.');
    return this.toMessageEvent(parsed);
  }

  private async readReplay(scope: string, lastEventId: string | undefined): Promise<StoredSseEvent[]> {
    const events = (await this.redis.lrange(this.eventsKey(scope), 0, -1))
      .map((value) => this.parse(value))
      .filter((event): event is StoredSseEvent => event !== null)
      .reverse();
    if (events.length === 0) return [];
    const latest = events.at(-1);
    if (!latest) return [];
    if (!lastEventId || !this.isCursorForScope(lastEventId, scope)) return [latest];
    const index = events.findIndex((event) => event.id === lastEventId);
    return index < 0 ? [latest] : events.slice(index + 1);
  }

  private fromMessageEvent(event: MessageEvent, id: string): StoredSseEvent {
    return { id, data: event.data, fingerprint: '', retry: event.retry, type: event.type };
  }

  private toMessageEvent(event: StoredSseEvent): MessageEvent {
    let data = event.data;
    if (event.dataEncoding === DATA_ENCODING && typeof data === 'string') {
      try { data = JSON.parse(data) as object; } catch { /* Preserve malformed legacy data. */ }
    }
    return { id: event.id, data, retry: event.retry, type: event.type };
  }

  private parse(value: string): StoredSseEvent | null {
    try {
      const event = JSON.parse(value) as StoredSseEvent;
      return typeof event.id === 'string' && typeof event.fingerprint === 'string' ? event : null;
    } catch { return null; }
  }

  private isCursorForScope(cursor: string, scope: string): boolean {
    return new RegExp(`^sse1\\.${this.scopeTag(scope)}\\.[0-9a-z]+\\.[0-9a-z]+$`).test(cursor);
  }

  private eventsKey(scope: string): string { return `sse-replay:v1:${scope}:events`; }
  private scopeTag(scope: string): string { return scope.slice(scope.lastIndexOf(':') + 1); }

  private readCursorSecret(): string {
    const secret = process.env.SSE_REPLAY_CURSOR_SECRET?.trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === 'production') throw new Error('SSE_REPLAY_CURSOR_SECRET is required in production.');
    return 'local-development-sse-replay-secret';
  }
}
