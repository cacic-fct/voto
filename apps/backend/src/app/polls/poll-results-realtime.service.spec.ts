import { PollResultsRealtimeService } from './poll-results-realtime.service';

describe('PollResultsRealtimeService', () => {
  it('uses one atomic shared counter to publish every third committed update', async () => {
    const redis = { eval: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1) };
    const service = new PollResultsRealtimeService(redis as never, {} as never);

    await expect(service.shouldPublishUpdate('poll-1', false)).resolves.toBe(false);
    await expect(service.shouldPublishUpdate('poll-1', false)).resolves.toBe(false);
    await expect(service.shouldPublishUpdate('poll-1', false)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'poll-results:pending:v1:poll-1', 'update', '3', '604800');
  });

  it('clears a partial batch and always publishes on closure, including an empty poll', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(1) };
    const service = new PollResultsRealtimeService(redis as never, {} as never);

    await expect(service.shouldPublishUpdate('poll-1', true)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'poll-results:pending:v1:poll-1', 'final', '3', '604800');
  });

  it('still refreshes results when Redis batching fails', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const service = new PollResultsRealtimeService(redis as never, {} as never);

    await expect(service.shouldPublishUpdate('poll-1', false)).resolves.toBe(true);
    await expect(service.shouldPublishUpdate('poll-1', true)).resolves.toBe(true);
  });

  it('retries transient replay recording and pub/sub failures with bounded attempts', async () => {
    const replay = {
      record: jest.fn()
        .mockRejectedValueOnce(new Error('replay unavailable'))
        .mockResolvedValue({ id: 'sse1.scope.1', data: { responseCount: 1 } }),
      scope: jest.fn().mockReturnValue('public:scope'),
    };
    const redis = {
      publish: jest.fn()
        .mockRejectedValueOnce(new Error('pub/sub unavailable'))
        .mockResolvedValue(1),
    };
    const service = new PollResultsRealtimeService(redis as never, replay as never);

    await service.publish('public:scope', { responseCount: 1 });

    expect(replay.record).toHaveBeenCalledTimes(2);
    expect(redis.publish).toHaveBeenCalledTimes(2);
  });

  it('passes the committed mutation identity to replay storage', async () => {
    const replay = {
      record: jest.fn().mockResolvedValue({ id: 'sse1.scope.1', data: { responseCount: 1 } }),
      scope: jest.fn(),
    };
    const redis = { publish: jest.fn().mockResolvedValue(1) };
    const service = new PollResultsRealtimeService(redis as never, replay as never);

    await service.publish('public:scope', { responseCount: 1 }, 'response-1:200');

    expect(replay.record).toHaveBeenCalledWith(
      'public:scope',
      { data: { responseCount: 1 }, retry: 3_000 },
      { deduplicationKey: 'response-1:200' },
    );
  });
});
