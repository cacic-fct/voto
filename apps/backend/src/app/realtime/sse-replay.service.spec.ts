import { MessageEvent } from '@nestjs/common';
import { firstValueFrom, NEVER, Subject, take } from 'rxjs';
import { SseReplayService } from './sse-replay.service';

class ReplayRedisStub {
  private readonly lists = new Map<string, string[]>();
  private sequence = 0;

  async eval(_script: string, _keys: number, eventsKey: string, _sequenceKey: string, fingerprint: string, raw: string, prefix: string): Promise<string> {
    const list = this.lists.get(eventsKey) ?? [];
    const latest = list[0] ? JSON.parse(list[0]) as { fingerprint: string } : null;
    if (latest?.fingerprint === fingerprint) return list[0];
    const stored = JSON.stringify({ ...JSON.parse(raw) as object, id: `${prefix}${++this.sequence}`, fingerprint });
    this.lists.set(eventsKey, [stored, ...list]);
    return stored;
  }

  async lrange(key: string): Promise<string[]> { return this.lists.get(key) ?? []; }
}

describe('SseReplayService', () => {
  it('records opaque event ids and resumes after Last-Event-ID', async () => {
    const service = new SseReplayService(new ReplayRedisStub() as never);
    const scope = service.scope('poll-results-public', 'poll-1');
    const first = await service.record(scope, { data: { responseCount: 1 } });
    const second = await service.record(scope, { data: { responseCount: 2 } });

    expect(first.id).toMatch(/^sse1\./);
    await expect(firstValueFrom(service.replay(scope, first.id, NEVER).pipe(take(1)))).resolves.toEqual(second);
  });

  it('returns only the latest snapshot for an invalid cursor and deduplicates identical snapshots', async () => {
    const service = new SseReplayService(new ReplayRedisStub() as never);
    const scope = service.scope('poll-results-admin', 'poll-1');
    const event: MessageEvent = { data: { responseCount: 1 } };
    const first = await service.record(scope, event);
    const duplicate = await service.record(scope, event);

    expect(duplicate.id).toBe(first.id);
    await expect(firstValueFrom(service.replay(scope, 'foreign-cursor', NEVER).pipe(take(1)))).resolves.toEqual(first);
  });

  it('keeps live delivery alive when replay storage fails and bounds pending events', async () => {
    const redis = {
      lrange: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const service = new SseReplayService(redis as never);
    const source = new Subject<MessageEvent>();
    const received: MessageEvent[] = [];
    const errors: unknown[] = [];
    const subscription = service.replay('public:scope', undefined, source).subscribe({
      next: (event) => received.push(event),
      error: (error) => errors.push(error),
    });

    for (let index = 0; index < 400; index += 1) {
      source.next({ id: `event-${index}`, data: '😀'.repeat(20_000) });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(errors).toEqual([]);
    expect(received.length).toBeLessThanOrEqual(256);
    expect(received.at(-1)?.data).toBe('😀'.repeat(20_000));
    source.next({ id: 'live-after-replay-failure', data: { ok: true } });
    expect(received.at(-1)).toEqual({ id: 'live-after-replay-failure', data: { ok: true } });
    subscription.unsubscribe();
  });
});
