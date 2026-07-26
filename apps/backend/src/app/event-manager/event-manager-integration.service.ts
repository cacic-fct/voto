import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import type { EventManagerVotingAttendanceCheckResponse } from '@cacic-fct/event-manager-m2m-contracts';
import { EventManagerEvent } from '@org/voting-contracts';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { GrpcUnaryClient, loadService } from '../grpc/grpc-runtime';

@Injectable()
export class EventManagerIntegrationService implements OnModuleDestroy {
  private readonly logger = new Logger(EventManagerIntegrationService.name);
  private readonly client = new GrpcUnaryClient(
    process.env.EVENT_MANAGER_GRPC_URL?.trim() || 'localhost:50051',
    loadService(
      'cacic/m2m/event_manager/v1/event-manager-m2m.proto',
      ['cacic', 'm2m', 'event_manager', 'v1'],
      'EventManagerM2M',
    ),
  );
  private readonly audience = process.env.EVENT_MANAGER_M2M_AUDIENCE;
  private readonly scope = process.env.EVENT_MANAGER_M2M_SCOPE;

  constructor(private readonly m2mTokens: KeycloakM2mTokenService) {}

  onModuleDestroy(): void {
    this.client.close();
  }

  async listLinkableEvents(): Promise<EventManagerEvent[]> {
    const accessToken = await this.getAccessToken();

    try {
      const data = await this.client.call<unknown>(
        'ListVotingEvents',
        {},
        this.metadata(accessToken),
        { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
      );

      if (!this.isRecord(data) || !Array.isArray(data['events'])) {
        throw new ServiceUnavailableException(
          'Event Manager returned an invalid event list.',
        );
      }

      return data['events'].map((item) => this.parseEvent(item));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.warn('Could not list Event Manager events.');
      throw new ServiceUnavailableException(
        'Could not list Event Manager events.',
      );
    }
  }

  async hasAttendance(eventId: string, userId: string): Promise<boolean> {
    const accessToken = await this.getAccessToken();

    try {
      const data = await this.client.call<EventManagerVotingAttendanceCheckResponse>(
        'CheckVotingAttendance',
        { eventId, userId },
        this.metadata(accessToken),
        { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
      );

      return data.attended === true;
    } catch {
      this.logger.warn('Could not verify Event Manager attendance.');
      throw new ServiceUnavailableException(
        'Could not verify Event Manager attendance.',
      );
    }
  }

  private getAccessToken(): Promise<string> {
    return this.m2mTokens.getClientCredentialsToken({
      audience: this.audience,
      scope: this.scope,
    });
  }

  private parseEvent(value: unknown): EventManagerEvent {
    if (!this.isRecord(value)) {
      throw new ServiceUnavailableException(
        'Event Manager returned an invalid event item.',
      );
    }

    const id = this.readRequiredString(value, 'id');
    const name = this.readRequiredString(value, 'name');
    const startDate = this.readRequiredString(value, 'startDate');
    const endDate = this.readRequiredString(value, 'endDate');
    const locationDescription =
      typeof value['locationDescription'] === 'string' &&
      value['locationDescription'].trim()
        ? value['locationDescription'].trim()
        : undefined;

    return {
      id,
      name,
      startDate,
      endDate,
      locationDescription,
      shouldCollectAttendance: value['shouldCollectAttendance'] === true,
    };
  }

  private readRequiredString(
    value: Record<string, unknown>,
    key: string,
  ): string {
    const rawValue = value[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw new ServiceUnavailableException(
        `Event Manager returned an invalid ${key}.`,
      );
    }

    return rawValue.trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private metadata(accessToken: string): Metadata {
    const metadata = new Metadata();
    metadata.set('authorization', `Bearer ${accessToken}`);
    return metadata;
  }
}
