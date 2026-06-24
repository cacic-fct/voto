import { Injectable, Logger } from '@nestjs/common';
import { GLOBAL_FEATURE_FLAGS } from './feature-flags.constants';

const DEFAULT_UNLEASH_FRONTEND_URL =
  'https://unleash.cacic.dev.br/api/frontend';
const DEFAULT_UNLEASH_CLIENT_KEYS = {
  development:
    'default:development.rUPorLb0LVO4VIBLZ5RX4TKvsvGuABYmpkmzpWa7QHXwqSZ20v0ppRGYCWAO',
  production:
    'default:production.h8sn3hzUSF07msdHkuXubAVRxSgtAdGsBCXiXXhcs8I4boeXozEue0Tx0lwq',
} as const;

interface CachedBooleanFlag {
  value: boolean;
  expiresAt: number;
}

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly cache = new Map<string, CachedBooleanFlag>();
  private readonly cacheTtlMs = this.parsePositiveInteger(
    process.env.UNLEASH_CACHE_TTL_MS,
    60_000,
  );
  private readonly timeoutMs = this.parsePositiveInteger(
    process.env.UNLEASH_TIMEOUT_MS,
    2_500,
  );

  async isUndergraduateUnespRoleVerificationDisabled(): Promise<boolean> {
    return this.isEnabled(
      GLOBAL_FEATURE_FLAGS.undergraduateUnespRoleVerificationDisabled,
      false,
    );
  }

  async isEnabled(flagName: string, fallback: boolean): Promise<boolean> {
    const cached = this.cache.get(flagName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const value = await this.fetchFlagValue(flagName, fallback);
      this.cache.set(flagName, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return value;
    } catch (error) {
      this.logger.warn('Unable to read Unleash feature flag', {
        flagName,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  private async fetchFlagValue(
    flagName: string,
    fallback: boolean,
  ): Promise<boolean> {
    const clientKey = this.readClientKey();
    if (!clientKey) {
      return fallback;
    }

    const response = await fetch(this.readFrontendUrl(), {
      headers: {
        Authorization: clientKey,
        'UNLEASH-APPNAME': this.readAppName(),
        'UNLEASH-ENVIRONMENT': this.readEnvironment(),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return this.readToggleValue(await response.json(), flagName) ?? fallback;
  }

  private readToggleValue(payload: unknown, flagName: string): boolean | null {
    for (const toggle of this.readToggleList(payload)) {
      if (!this.isRecord(toggle)) {
        continue;
      }

      if (toggle['name'] === flagName && typeof toggle['enabled'] === 'boolean') {
        return toggle['enabled'];
      }
    }

    return null;
  }

  private readToggleList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const toggles = payload['toggles'];
    if (Array.isArray(toggles)) {
      return toggles;
    }

    const features = payload['features'];
    return Array.isArray(features) ? features : [];
  }

  private readFrontendUrl(): string {
    return (
      process.env.UNLEASH_FRONTEND_API_URL ||
      process.env.UNLEASH_API_URL ||
      DEFAULT_UNLEASH_FRONTEND_URL
    );
  }

  private readClientKey(): string {
    if (process.env.UNLEASH_FRONTEND_CLIENT_KEY) {
      return process.env.UNLEASH_FRONTEND_CLIENT_KEY;
    }

    if (process.env.UNLEASH_CLIENT_KEY) {
      return process.env.UNLEASH_CLIENT_KEY;
    }

    return this.readEnvironment() === 'production'
      ? DEFAULT_UNLEASH_CLIENT_KEYS.production
      : DEFAULT_UNLEASH_CLIENT_KEYS.development;
  }

  private readAppName(): string {
    return process.env.UNLEASH_APP_NAME || 'cacic-voto-backend';
  }

  private readEnvironment(): 'development' | 'production' {
    const configured = process.env.UNLEASH_ENVIRONMENT || process.env.NODE_ENV;
    return configured === 'production' ? 'production' : 'development';
  }

  private parsePositiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}

