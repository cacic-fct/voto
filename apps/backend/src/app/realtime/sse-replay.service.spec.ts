import { MessageEvent } from '@nestjs/common';
import { firstValueFrom, NEVER, take } from 'rxjs';
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
});
