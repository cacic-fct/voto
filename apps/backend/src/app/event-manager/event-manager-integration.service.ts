import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EventManagerEvent } from '@org/voting-contracts';
import axios from 'axios';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';

type EventManagerVotingAttendanceCheckResponse = {
  attended: boolean;
};

const EVENT_MANAGER_M2M_API_PREFIX = '/api';
const EVENT_MANAGER_M2M_VOTING_ROUTES = {
  events: () => `${EVENT_MANAGER_M2M_API_PREFIX}/internal/voting/events`,
  attendanceCheck: (eventId: string) =>
    `${EVENT_MANAGER_M2M_API_PREFIX}/internal/voting/events/${encodeURIComponent(eventId)}/attendance-check`,
};

@Injectable()
export class EventManagerIntegrationService {
  private readonly logger = new Logger(EventManagerIntegrationService.name);
  private readonly eventManagerOrigin = this.resolveEventManagerOrigin(
    process.env.EVENT_MANAGER_API_URL ?? 'https://eventos.cacic.dev.br/api',
  );
  private readonly audience = process.env.EVENT_MANAGER_M2M_AUDIENCE;
  private readonly scope = process.env.EVENT_MANAGER_M2M_SCOPE;

  constructor(private readonly m2mTokens: KeycloakM2mTokenService) {}

  async listLinkableEvents(): Promise<EventManagerEvent[]> {
    const accessToken = await this.getAccessToken();

    try {
      const { data } = await axios.get<unknown>(
        this.eventManagerUrl(EVENT_MANAGER_M2M_VOTING_ROUTES.events()),
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!Array.isArray(data)) {
        throw new ServiceUnavailableException('Event Manager returned an invalid event list.');
      }

      return data.map((item) => this.parseEvent(item));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logAxiosWarning(error, 'Could not list Event Manager events.');
      throw new ServiceUnavailableException('Could not list Event Manager events.');
    }
  }

  async hasAttendance(eventId: string, userId: string): Promise<boolean> {
    const accessToken = await this.getAccessToken();

    try {
      const { data } = await axios.post<EventManagerVotingAttendanceCheckResponse>(
        this.eventManagerUrl(EVENT_MANAGER_M2M_VOTING_ROUTES.attendanceCheck(eventId)),
        { userId },
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return data.attended === true;
    } catch (error) {
      this.logAxiosWarning(error, 'Could not verify Event Manager attendance.');
      throw new ServiceUnavailableException('Could not verify Event Manager attendance.');
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
      throw new ServiceUnavailableException('Event Manager returned an invalid event item.');
    }

    const id = this.readRequiredString(value, 'id');
    const name = this.readRequiredString(value, 'name');
    const startDate = this.readRequiredString(value, 'startDate');
    const endDate = this.readRequiredString(value, 'endDate');
    const locationDescription =
      typeof value['locationDescription'] === 'string' && value['locationDescription'].trim()
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

  private readRequiredString(value: Record<string, unknown>, key: string): string {
    const rawValue = value[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw new ServiceUnavailableException(`Event Manager returned an invalid ${key}.`);
    }

    return rawValue.trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private eventManagerUrl(path: string): string {
    return new URL(path, this.eventManagerOrigin).toString();
  }

  private resolveEventManagerOrigin(eventManagerApiUrl: string): string {
    return new URL(eventManagerApiUrl.replace(/\/+$/, '')).origin;
  }

  private logAxiosWarning(error: unknown, message: string): void {
    if (axios.isAxiosError(error)) {
      this.logger.warn(`${message} Status=${error.response?.status ?? 'none'}.`);
      return;
    }

    this.logger.warn(message);
  }
}
