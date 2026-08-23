import { Injectable, Logger, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { SseReplayService } from '../realtime/sse-replay.service';

const REDIS_CHANNEL = 'poll-results:realtime:v1';
const MAX_PUBLICATION_ATTEMPTS = 3;

interface Envelope { scope: string; event: MessageEvent }

@Injectable()
export class PollResultsRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollResultsRealtimeService.name);
  private readonly channels = new Map<string, Subject<MessageEvent>>();
  private subscriber?: Redis;

  constructor(private readonly redis: Redis, private readonly replay: SseReplayService) {}

  async onModuleInit(): Promise<void> {
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    await subscriber.subscribe(REDIS_CHANNEL);
    subscriber.on('message', (_channel, payload) => {
      const envelope = this.parseEnvelope(payload);
      if (envelope) this.channels.get(envelope.scope)?.next(envelope.event);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.channels.forEach((channel) => channel.complete());
    this.channels.clear();
    if (this.subscriber) {
      await this.subscriber.unsubscribe(REDIS_CHANNEL).catch(() => undefined);
      this.subscriber.disconnect();
    }
  }

  scope(audience: 'admin' | 'observer' | 'public', pollId: string): string {
    return this.replay.scope(`poll-results-${audience}`, pollId);
  }

  watch(scope: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const channel = this.channels.get(scope) ?? new Subject<MessageEvent>();
      this.channels.set(scope, channel);
      const subscription = channel.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        if (channel.observed === false) this.channels.delete(scope);
      };
    });
  }

  async publish(scope: string, data: object): Promise<void> {
    let event: MessageEvent | undefined;
    for (let attempt = 1; attempt <= MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
      try {
        event = await this.replay.record(scope, { data, retry: 3_000 });
        break;
      } catch (error) {
        if (attempt === MAX_PUBLICATION_ATTEMPTS) {
          this.logger.warn(`Poll result replay recording failed for scope ${scope}.`, error);
          this.channels.get(scope)?.next({ data, retry: 3_000 });
          return;
        }
        await this.delay(25 * 2 ** (attempt - 1));
      }
    }

    if (!event) {
      return;
    }
    const publishedEvent = event;
    const payload = JSON.stringify({ scope, event: publishedEvent } satisfies Envelope);
    for (let attempt = 1; attempt <= MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
      try {
        const subscribers = await this.redis.publish(REDIS_CHANNEL, payload);
        if (subscribers === 0) this.channels.get(scope)?.next(publishedEvent);
        return;
      } catch (error) {
        if (attempt === MAX_PUBLICATION_ATTEMPTS) {
          this.logger.warn(`Poll result pub/sub delivery failed for scope ${scope}.`, error);
          this.channels.get(scope)?.next(publishedEvent);
          return;
        }
        await this.delay(25 * 2 ** (attempt - 1));
      }
    }
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private parseEnvelope(payload: string): Envelope | null {
    try {
      const envelope = JSON.parse(payload) as Envelope;
      return typeof envelope.scope === 'string' && envelope.event && typeof envelope.event === 'object'
        ? envelope
        : null;
    } catch { return null; }
  }
}
