import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  M2MUserEnrollmentLookupRequest,
  M2MUserIdentifierLookupRequest,
  M2MUserIdentifierType,
} from '@cacic-fct/account-manager-m2m-contracts';
import { AccountManagerPerson } from '@org/voting-contracts';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { authorizationMetadata, GrpcUnaryClient, loadService } from '../grpc/grpc-runtime';

const ENROLLMENT_LOOKUP_BATCH_SIZE = 500;
const IDENTIFIER_LOOKUP_BATCH_SIZE = 200;
@Injectable()
export class AccountManagerIntegrationService implements OnModuleDestroy {
  private readonly logger = new Logger(AccountManagerIntegrationService.name);
  private readonly client = new GrpcUnaryClient(
    requiredAccountManagerGrpcUrl(),
    loadService(
      'account-manager-m2m.proto',
      ['cacic', 'm2m', 'account_manager', 'v1'],
      'AccountManagerM2M',
    ),
  );
  private readonly audience = process.env.ACCOUNT_MANAGER_M2M_AUDIENCE;
  private readonly scope = process.env.ACCOUNT_MANAGER_M2M_SCOPE;

  constructor(private readonly m2mTokens: KeycloakM2mTokenService) {}

  onModuleDestroy(): void {
    this.client.close();
  }

  async lookupPeopleByEnrollmentNumbers(
    enrollmentNumbers: readonly string[],
  ): Promise<AccountManagerPerson[]> {
    const uniqueEnrollmentNumbers = [
      ...new Set(
        enrollmentNumbers.map((value) => value.trim()).filter(Boolean),
      ),
    ];
    if (uniqueEnrollmentNumbers.length === 0) {
      return [];
    }

    const accessToken = await this.getAccessToken();
    const people: AccountManagerPerson[] = [];

    for (
      let index = 0;
      index < uniqueEnrollmentNumbers.length;
      index += ENROLLMENT_LOOKUP_BATCH_SIZE
    ) {
      const batch = uniqueEnrollmentNumbers.slice(
        index,
        index + ENROLLMENT_LOOKUP_BATCH_SIZE,
      );
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
      .filter(
        (identifier) => identifier.requestId && identifier.identifierValue,
      );
    const peopleByRequestId = new Map<string, AccountManagerPerson[]>();
    if (normalizedIdentifiers.length === 0) {
      return peopleByRequestId;
    }

    const accessToken = await this.getAccessToken();
    for (
      let index = 0;
      index < normalizedIdentifiers.length;
      index += IDENTIFIER_LOOKUP_BATCH_SIZE
    ) {
      const batch = normalizedIdentifiers.slice(
        index,
        index + IDENTIFIER_LOOKUP_BATCH_SIZE,
      );
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
      const data = await this.client.call<unknown>(
        'LookupUsersByEnrollment',
        { enrollmentNumbers } satisfies M2MUserEnrollmentLookupRequest,
        authorizationMetadata(accessToken),
        { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
      );

      return this.parseEnrollmentLookupResponse(data);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.warn('Could not lookup Account Manager users by enrollment number.', error);
      throw new ServiceUnavailableException(
        'Could not lookup Account Manager users.',
      );
    }
  }

  private async lookupIdentifierBatch(
    identifiers: M2MUserIdentifierLookupRequest['identifiers'],
    accessToken: string,
  ): Promise<(AccountManagerPerson & { requestId: string })[]> {
    try {
      const data = await this.client.call<unknown>(
        'LookupUsersByIdentifier',
        { identifiers } satisfies M2MUserIdentifierLookupRequest,
        authorizationMetadata(accessToken),
        { idempotent: true, maxAttempts: 3, timeoutMs: 10_000 },
      );

      return this.parseIdentifierLookupResponse(data);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.warn('Could not lookup Account Manager users by private identifier.', error);
      throw new ServiceUnavailableException(
        'Could not lookup Account Manager users.',
      );
    }
  }

  private parseEnrollmentLookupResponse(
    value: unknown,
  ): AccountManagerPerson[] {
    if (!this.isRecord(value) || !Array.isArray(value['users'])) {
      throw new ServiceUnavailableException(
        'Account Manager returned an invalid user lookup response.',
      );
    }

    return value['users'].map((user) => this.parseUserProfile(user));
  }

  private parseIdentifierLookupResponse(
    value: unknown,
  ): (AccountManagerPerson & { requestId: string })[] {
    if (!this.isRecord(value) || !Array.isArray(value['users'])) {
      throw new ServiceUnavailableException(
        'Account Manager returned an invalid user identifier lookup response.',
      );
    }

    return value['users'].map((user) => {
      if (!this.isRecord(user)) {
        throw new ServiceUnavailableException(
          'Account Manager returned an invalid user item.',
        );
      }

      return {
        ...this.parseUserProfile(user),
        requestId: this.readRequiredString(user, 'requestId'),
      };
    });
  }

  private parseUserProfile(value: unknown): AccountManagerPerson {
    if (!this.isRecord(value)) {
      throw new ServiceUnavailableException(
        'Account Manager returned an invalid user item.',
      );
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
      ...(user.enrollmentNumber
        ? { enrollmentNumber: user.enrollmentNumber }
        : {}),
      name: user.name,
      email: user.email ?? null,
    };
  }

  private readRequiredString(
    value: Record<string, unknown>,
    key: string,
  ): string {
    const rawValue = value[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw new ServiceUnavailableException(
        `Account Manager returned an invalid ${key}.`,
      );
    }

    return rawValue.trim();
  }

  private readOptionalString(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const rawValue = value[key];
    return typeof rawValue === 'string' && rawValue.trim()
      ? rawValue.trim()
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

}

function requiredAccountManagerGrpcUrl(): string {
  const target = process.env.ACCOUNT_MANAGER_GRPC_URL?.trim();
  if (!target) throw new Error('ACCOUNT_MANAGER_GRPC_URL must be configured.');
  return target;
}
