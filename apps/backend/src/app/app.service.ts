import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';

type ReadinessComponent = {
  status: 'ok' | 'error';
  reason?: 'timeout';
};

type ReadinessResult = {
  status: 'ok';
  components: {
    database: ReadinessComponent;
    redis: ReadinessComponent;
  };
};

type ProbeOutcome = {
  status: 'ok' | 'error';
  timedOut?: boolean;
};

type ProbeHandle = {
  result: Promise<ProbeOutcome>;
  completion: Promise<void>;
};

type ActiveReadinessProbe = {
  result: Promise<ReadinessResult>;
  completion: Promise<void>;
};

const DEFAULT_READINESS_PROBE_TIMEOUT_MS = 1_500;

@Injectable()
export class AppService {
  private readonly readinessProbeTimeoutMs = this.parsePositiveInteger(
    process.env.READINESS_PROBE_TIMEOUT_MS,
    DEFAULT_READINESS_PROBE_TIMEOUT_MS,
  );
  private activeReadinessProbe?: ActiveReadinessProbe;

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
    if (this.activeReadinessProbe) {
      return this.activeReadinessProbe.result;
    }

    const databaseProbe = this.startProbe(() => this.prisma.$queryRaw`SELECT 1`);
    const redisProbe = this.startProbe(() => this.redis.ping());
    const result = Promise.all([databaseProbe.result, redisProbe.result]).then(
      ([database, redis]) => {
        const components = {
          database: this.toReadinessComponent(database),
          redis: this.toReadinessComponent(redis),
        } as const;

        if (database.status === 'error' || redis.status === 'error') {
          throw new ServiceUnavailableException({ status: 'error', components });
        }

        return { status: 'ok' as const, components };
      },
    );
    const completion = Promise.all([databaseProbe.completion, redisProbe.completion]).then(() => undefined);
    const activeProbe: ActiveReadinessProbe = { result, completion };
    this.activeReadinessProbe = activeProbe;
    void completion.finally(() => {
      if (this.activeReadinessProbe === activeProbe) {
        this.activeReadinessProbe = undefined;
      }
    });

    return result;
  }

  private startProbe(operation: () => Promise<unknown>): ProbeHandle {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const operationResult: Promise<ProbeOutcome> = Promise.resolve()
      .then(operation)
      .then(
        () => ({ status: 'ok' }),
        () => ({ status: 'error' }),
      );
    const completion = operationResult.then(() => undefined);
    const result = Promise.race([
      operationResult,
      new Promise<ProbeOutcome>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'error', timedOut: true }), this.readinessProbeTimeoutMs);
      }),
    ]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

    return { result, completion };
  }

  private toReadinessComponent(outcome: ProbeOutcome): ReadinessComponent {
    return outcome.timedOut
      ? { status: 'error', reason: 'timeout' }
      : { status: outcome.status };
  }

  private parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
    const value = Number.parseInt(rawValue ?? '', 10);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return value;
  }
}
