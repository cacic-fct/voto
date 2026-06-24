import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  EVENT_MANAGER_M2M_API_PREFIX,
  EVENT_MANAGER_M2M_VOTING_ROUTES,
  type EventManagerVotingAttendanceCheckResponse,
  type EventManagerVotingEvent,
} from '@cacic-fct/event-manager-m2m-contracts';
import { EventManagerPerson } from '@org/voting-contracts';
import axios from 'axios';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';

type EventManagerVotingRoutesWithPeopleLookup = typeof EVENT_MANAGER_M2M_VOTING_ROUTES & {
  peopleLookup?: () => string;
};

const PEOPLE_LOOKUP_BATCH_SIZE = 500;

@Injectable()
export class EventManagerIntegrationService {
  private readonly logger = new Logger(EventManagerIntegrationService.name);
  private readonly eventManagerOrigin = this.resolveEventManagerOrigin(
    process.env.EVENT_MANAGER_API_URL ?? 'https://eventos.cacic.dev.br/api',
  );
  private readonly audience = process.env.EVENT_MANAGER_M2M_AUDIENCE;
  private readonly scope = process.env.EVENT_MANAGER_M2M_SCOPE;

  constructor(private readonly m2mTokens: KeycloakM2mTokenService) {}

  async listLinkableEvents(): Promise<EventManagerVotingEvent[]> {
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

  async lookupPeopleByEnrollmentNumbers(enrollmentNumbers: readonly string[]): Promise<EventManagerPerson[]> {
    const uniqueEnrollmentNumbers = [...new Set(enrollmentNumbers.map((value) => value.trim()).filter(Boolean))];
    if (uniqueEnrollmentNumbers.length === 0) {
      return [];
    }

    const accessToken = await this.getAccessToken();
    const people: EventManagerPerson[] = [];

    for (let index = 0; index < uniqueEnrollmentNumbers.length; index += PEOPLE_LOOKUP_BATCH_SIZE) {
      const batch = uniqueEnrollmentNumbers.slice(index, index + PEOPLE_LOOKUP_BATCH_SIZE);
      people.push(...(await this.lookupPeopleBatch(batch, accessToken)));
    }

    return people;
  }

  private getAccessToken(): Promise<string> {
    return this.m2mTokens.getClientCredentialsToken({
      audience: this.audience,
      scope: this.scope,
    });
  }

  private parseEvent(value: unknown): EventManagerVotingEvent {
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

  private async lookupPeopleBatch(enrollmentNumbers: string[], accessToken: string): Promise<EventManagerPerson[]> {
    try {
      const { data } = await axios.post<unknown>(
        this.eventManagerUrl(this.peopleLookupRoute()),
        { enrollmentNumbers },
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return this.parsePeopleLookupResponse(data);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logAxiosWarning(error, 'Could not lookup Event Manager people.');
      throw new ServiceUnavailableException('Could not lookup Event Manager people.');
    }
  }

  private parsePeopleLookupResponse(value: unknown): EventManagerPerson[] {
    if (!this.isRecord(value) || !Array.isArray(value['people'])) {
      throw new ServiceUnavailableException('Event Manager returned an invalid people lookup response.');
    }

    return value['people'].map((item) => this.parsePerson(item));
  }

  private parsePerson(value: unknown): EventManagerPerson {
    if (!this.isRecord(value)) {
      throw new ServiceUnavailableException('Event Manager returned an invalid person item.');
    }

    const enrollmentNumber = this.readRequiredString(value, 'enrollmentNumber');
    const name = this.readRequiredString(value, 'name');
    const email =
      typeof value['email'] === 'string' && value['email'].trim() ? value['email'].trim() : null;

    return {
      enrollmentNumber,
      name,
      email,
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

  private peopleLookupRoute(): string {
    const routes = EVENT_MANAGER_M2M_VOTING_ROUTES as EventManagerVotingRoutesWithPeopleLookup;
    return routes.peopleLookup?.() ?? `${EVENT_MANAGER_M2M_API_PREFIX}/internal/voting/people/lookup`;
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
