import { describe, expect, it } from 'vitest';
import { appConfig } from './app.config';
import { config } from './app.config.server';

describe('server app config', () => {
  it('merges browser app providers with server rendering providers', () => {
    expect(config.providers?.length).toBeGreaterThan(appConfig.providers?.length ?? 0);
  });
});
