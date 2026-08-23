import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';

type ReadinessComponent = {
  status: 'ok' | 'error';
};

type ReadinessResult = {
  status: 'ok';
  components: {
    database: ReadinessComponent;
    redis: ReadinessComponent;
  };
};

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: Redis,
  ) {}

  getData(): { status: string; name: string } {
    return { status: 'ok', name: 'CACiC Voto API' };
  }

  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);
    const components = {
      database: { status: database.status === 'fulfilled' ? 'ok' : 'error' },
      redis: { status: redis.status === 'fulfilled' ? 'ok' : 'error' },
    } as const;

    if (database.status === 'rejected' || redis.status === 'rejected') {
      throw new ServiceUnavailableException({ status: 'error', components });
    }

    return { status: 'ok', components };
  }
}
