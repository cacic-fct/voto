import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
      return;
    }

    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('constructs with an explicit database URL', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example:5432/cacic_voto';

    expect(new PrismaService()).toBeDefined();
  });

  it('constructs with the default local database URL', () => {
    delete process.env.DATABASE_URL;

    expect(new PrismaService()).toBeDefined();
  });

  it('connects and disconnects during module lifecycle hooks', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes the Nest app before process exit', async () => {
    const service = new PrismaService();
    const app = { close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined) };
    const once = jest.spyOn(process, 'once');

    await service.enableShutdownHooks(app as never);
    const listener = once.mock.calls.find(([event]) => event === 'beforeExit')?.[1] as
      | (() => Promise<void>)
      | undefined;

    expect(listener).toEqual(expect.any(Function));
    process.removeListener('beforeExit', listener as () => void);
    await listener?.();
    expect(app.close).toHaveBeenCalledTimes(1);
    once.mockRestore();
  });
});
