import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  M2MUserEnrollmentLookupRequest,
  M2MUserIdentifierLookupRequest,
  M2MUserIdentifierType,
} from '@cacic-fct/account-manager-m2m-contracts';
import { AccountManagerPerson } from '@org/voting-contracts';
import axios from 'axios';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';

const ENROLLMENT_LOOKUP_BATCH_SIZE = 500;
const IDENTIFIER_LOOKUP_BATCH_SIZE = 200;
const ACCOUNT_MANAGER_M2M_USER_ROUTES = {
  enrollmentLookup: () => '/api/v1/users/enrollment-lookup',
  identifierLookup: () => '/api/v1/users/identifier-lookup',
} as const;

@Injectable()
export class AccountManagerIntegrationService {
  private readonly logger = new Logger(AccountManagerIntegrationService.name);
  private readonly accountManagerOrigin = this.resolveAccountManagerOrigin(
    process.env.ACCOUNT_MANAGER_API_URL ?? 'https://account.cacic.dev.br/api',
  );
  private readonly audience = process.env.ACCOUNT_MANAGER_M2M_AUDIENCE;
  private readonly scope = process.env.ACCOUNT_MANAGER_M2M_SCOPE;

  constructor(private readonly m2mTokens: KeycloakM2mTokenService) {}

  async lookupPeopleByEnrollmentNumbers(
    enrollmentNumbers: readonly string[],
  ): Promise<AccountManagerPerson[]> {
    const uniqueEnrollmentNumbers = [
      ...new Set(enrollmentNumbers.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueEnrollmentNumbers.length === 0) {
      return [];
    }

    const accessToken = await this.getAccessToken();
    const people: AccountManagerPerson[] = [];

    for (let index = 0; index < uniqueEnrollmentNumbers.length; index += ENROLLMENT_LOOKUP_BATCH_SIZE) {
      const batch = uniqueEnrollmentNumbers.slice(index, index + ENROLLMENT_LOOKUP_BATCH_SIZE);
      people.push(...(await this.lookupEnrollmentBatch(batch, accessToken)));
    }

    return people;
  }

  async lookupPeopleByIdentifiers(
    identifiers: readonly {
      requestId: string;
      identifierType: M2MUserIdentifierType;
      identifierValue: string;
    }[],
  ): Promise<Map<string, AccountManagerPerson[]>> {
    const normalizedIdentifiers = identifiers
      .map((identifier) => ({
        requestId: identifier.requestId.trim(),
        identifierType: identifier.identifierType,
        identifierValue: identifier.identifierValue.trim(),
      }))
      .filter((identifier) => identifier.requestId && identifier.identifierValue);
    const peopleByRequestId = new Map<string, AccountManagerPerson[]>();
    if (normalizedIdentifiers.length === 0) {
      return peopleByRequestId;
    }

    const accessToken = await this.getAccessToken();
    for (let index = 0; index < normalizedIdentifiers.length; index += IDENTIFIER_LOOKUP_BATCH_SIZE) {
      const batch = normalizedIdentifiers.slice(index, index + IDENTIFIER_LOOKUP_BATCH_SIZE);
      const users = await this.lookupIdentifierBatch(batch, accessToken);
      for (const user of users) {
        const existingPeople = peopleByRequestId.get(user.requestId) ?? [];
        peopleByRequestId.set(user.requestId, [
          ...existingPeople,
          this.toAccountManagerPerson(user),
        ]);
      }
    }

    return peopleByRequestId;
  }

  private getAccessToken(): Promise<string> {
    return this.m2mTokens.getClientCredentialsToken({
      audience: this.audience,
      scope: this.scope,
    });
  }

  private async lookupEnrollmentBatch(
    enrollmentNumbers: string[],
    accessToken: string,
  ): Promise<AccountManagerPerson[]> {
    try {
      const { data } = await axios.post<unknown>(
        this.accountManagerUrl(ACCOUNT_MANAGER_M2M_USER_ROUTES.enrollmentLookup()),
        { enrollmentNumbers } satisfies M2MUserEnrollmentLookupRequest,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return this.parseEnrollmentLookupResponse(data);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logAxiosWarning(error, 'Could not lookup Account Manager users by enrollment number.');
      throw new ServiceUnavailableException('Could not lookup Account Manager users.');
    }
  }

  private async lookupIdentifierBatch(
    identifiers: M2MUserIdentifierLookupRequest['identifiers'],
    accessToken: string,
  ): Promise<(AccountManagerPerson & { requestId: string })[]> {
    try {
      const { data } = await axios.post<unknown>(
        this.accountManagerUrl(ACCOUNT_MANAGER_M2M_USER_ROUTES.identifierLookup()),
        { identifiers } satisfies M2MUserIdentifierLookupRequest,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return this.parseIdentifierLookupResponse(data);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logAxiosWarning(error, 'Could not lookup Account Manager users by private identifier.');
      throw new ServiceUnavailableException('Could not lookup Account Manager users.');
    }
  }

  private parseEnrollmentLookupResponse(value: unknown): AccountManagerPerson[] {
    if (!this.isRecord(value) || !Array.isArray(value['users'])) {
      throw new ServiceUnavailableException('Account Manager returned an invalid user lookup response.');
    }

    return value['users'].map((user) => this.parseUserProfile(user));
  }

  private parseIdentifierLookupResponse(
    value: unknown,
  ): (AccountManagerPerson & { requestId: string })[] {
    if (!this.isRecord(value) || !Array.isArray(value['users'])) {
      throw new ServiceUnavailableException('Account Manager returned an invalid user identifier lookup response.');
    }

    return value['users'].map((user) => {
      if (!this.isRecord(user)) {
        throw new ServiceUnavailableException('Account Manager returned an invalid user item.');
      }

      return {
        ...this.parseUserProfile(user),
        requestId: this.readRequiredString(user, 'requestId'),
      };
    });
  }

  private parseUserProfile(value: unknown): AccountManagerPerson {
    if (!this.isRecord(value)) {
      throw new ServiceUnavailableException('Account Manager returned an invalid user item.');
    }

    const userId = this.readOptionalString(value, 'userId');
    const name = this.readRequiredString(value, 'name');
    const enrollmentNumber = this.readOptionalString(value, 'enrollmentNumber');
    const email = this.readOptionalString(value, 'email') ?? null;

    return {
      ...(userId ? { userId } : {}),
      ...(enrollmentNumber ? { enrollmentNumber } : {}),
      name,
      email,
    };
  }

  private toAccountManagerPerson(
    user: AccountManagerPerson & { requestId: string },
  ): AccountManagerPerson {
    return {
      ...(user.userId ? { userId: user.userId } : {}),
      ...(user.enrollmentNumber ? { enrollmentNumber: user.enrollmentNumber } : {}),
      name: user.name,
      email: user.email ?? null,
    };
  }

  private readRequiredString(value: Record<string, unknown>, key: string): string {
    const rawValue = value[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw new ServiceUnavailableException(`Account Manager returned an invalid ${key}.`);
    }

    return rawValue.trim();
  }

  private readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
    const rawValue = value[key];
    return typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private accountManagerUrl(path: string): string {
    return new URL(path, this.accountManagerOrigin).toString();
  }

  private resolveAccountManagerOrigin(accountManagerApiUrl: string): string {
    return new URL(accountManagerApiUrl.replace(/\/+$/, '')).origin;
  }

  private logAxiosWarning(error: unknown, message: string): void {
    if (axios.isAxiosError(error)) {
      this.logger.warn(`${message} Status=${error.response?.status ?? 'none'}.`);
      return;
    }

    this.logger.warn(message);
  }
}
