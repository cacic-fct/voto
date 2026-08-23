import { PollResultsRealtimeService } from './poll-results-realtime.service';

describe('PollResultsRealtimeService', () => {
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
});
