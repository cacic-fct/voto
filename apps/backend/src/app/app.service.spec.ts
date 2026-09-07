import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppService', () => {
  const originalReadinessTimeout = process.env.READINESS_PROBE_TIMEOUT_MS;
  let service: AppService;
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
    process.env.READINESS_PROBE_TIMEOUT_MS = '10';
    prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockReset().mockResolvedValue('PONG');
    const app = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
        { provide: Redis, useValue: redis },
      ],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  afterAll(() => {
    if (originalReadinessTimeout === undefined) delete process.env.READINESS_PROBE_TIMEOUT_MS;
    else process.env.READINESS_PROBE_TIMEOUT_MS = originalReadinessTimeout;
  });

  describe('getData', () => {
    it('should return API health data', () => {
      expect(service.getData()).toEqual({
        status: 'ok',
        name: 'CACiC Voto API',
      });
    });
  });

  it('reports liveness without touching dependencies', () => {
    expect(service.getLiveness()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('reports readiness when required dependencies respond', async () => {
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      components: { database: { status: 'ok' }, redis: { status: 'ok' } },
    });
  });

  it('reports the failed component without exposing dependency errors', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database password leaked here'));

    await expect(service.getReadiness()).rejects.toEqual(
      new ServiceUnavailableException({
        status: 'error',
        components: { database: { status: 'error' }, redis: { status: 'ok' } },
      }),
    );
  });

  it('times out stalled probes, identifies both components, and shares the in-flight work', async () => {
    jest.useFakeTimers();
    let resolveDatabase: (() => void) | undefined;
    let resolveRedis: (() => void) | undefined;
    prisma.$queryRaw.mockReturnValueOnce(new Promise((resolve) => {
      resolveDatabase = () => resolve([{ '?column?': 1 }]);
    }));
    redis.ping.mockReturnValueOnce(new Promise((resolve) => {
      resolveRedis = () => resolve('PONG');
    }));

    const firstReadiness = service.getReadiness();
    const secondReadiness = service.getReadiness();
    await Promise.resolve();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.ping).toHaveBeenCalledTimes(1);

    const expectedTimeout = new ServiceUnavailableException({
      status: 'error',
      components: {
        database: { status: 'error', reason: 'timeout' },
        redis: { status: 'error', reason: 'timeout' },
      },
    });
    const firstExpectation = expect(firstReadiness).rejects.toEqual(expectedTimeout);
    const secondExpectation = expect(secondReadiness).rejects.toEqual(expectedTimeout);
    await jest.advanceTimersByTimeAsync(11);
    await firstExpectation;
    await secondExpectation;

    resolveDatabase?.();
    resolveRedis?.();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    jest.useRealTimers();
  });

  it('starts a fresh readiness probe after stalled dependency work recovers', async () => {
    jest.useFakeTimers();
    let resolveDatabase: (() => void) | undefined;
    let resolveRedis: (() => void) | undefined;
    prisma.$queryRaw.mockReturnValueOnce(new Promise((resolve) => {
      resolveDatabase = () => resolve([{ '?column?': 1 }]);
    }));
    redis.ping.mockReturnValueOnce(new Promise((resolve) => {
      resolveRedis = () => resolve('PONG');
    }));

    const stalled = service.getReadiness();
    const stalledExpectation = expect(stalled).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(11);
    await stalledExpectation;

    resolveDatabase?.();
    resolveRedis?.();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    redis.ping.mockResolvedValueOnce('PONG');
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      components: { database: { status: 'ok' }, redis: { status: 'ok' } },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(redis.ping).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
