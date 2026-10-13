jest.mock('dotenv/config', () => ({}));
jest.mock('./app/bootstrap/backend-bootstrap', () => ({
  bootstrap: jest.fn(),
}));

import { bootstrap } from './app/bootstrap/backend-bootstrap';

describe('backend executable entry point', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.clearAllMocks();
  });

  it('runs startup unconditionally and marks startup rejection as failure', async () => {
    jest.mocked(bootstrap).mockRejectedValue(new Error('Startup failed'));

    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });
    await Promise.resolve();

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it('keeps a successful startup from changing the process exit code', async () => {
    process.exitCode = undefined;
    jest.mocked(bootstrap).mockResolvedValue(undefined);

    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });
});
