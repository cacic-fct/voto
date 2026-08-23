import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppService', () => {
  let service: AppService;
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
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
});
