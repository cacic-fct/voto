import { ServiceUnavailableException } from '@nestjs/common';

export const KEYCLOAK_UNAVAILABLE_ERROR_CODE = 'KEYCLOAK_UNAVAILABLE';

export function keycloakUnavailableException(
  message = 'Identity provider is temporarily unavailable.',
): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: KEYCLOAK_UNAVAILABLE_ERROR_CODE,
    message,
  });
}
