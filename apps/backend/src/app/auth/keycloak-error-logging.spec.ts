import { summarizeKeycloakFailure } from './keycloak-error-logging';

describe('summarizeKeycloakFailure', () => {
  it('summarizes safe Keycloak response fields and redacts token-like values', () => {
    const summary = summarizeKeycloakFailure({
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: {
          error: 'invalid_grant',
          error_description: 'Invalid code=abc123 refresh_token=secret',
        },
      },
    });

    expect(summary.message).toBe(
      'status=400 Bad Request; error=invalid_grant; description=Invalid code=[redacted] refresh_token=[redacted]; axiosCode=ERR_BAD_REQUEST',
    );
    expect(summary.dedupeKey).toBe(
      'status=400|error=invalid_grant|description=Invalid code=[redacted] refresh_token=[redacted]|axiosCode=ERR_BAD_REQUEST',
    );
  });

  it('summarizes response bodies, non-sensitive response keys, and network errors', () => {
    expect(
      summarizeKeycloakFailure({
        isAxiosError: true,
        response: {
          status: 503,
          statusText: 'Service Unavailable',
          data: 'temporarily unavailable',
        },
      }).message,
    ).toBe('status=503 Service Unavailable; body=temporarily unavailable');

    expect(
      summarizeKeycloakFailure({
        isAxiosError: true,
        response: {
          status: 500,
          data: {
            access_token: 'secret',
            retryAfter: 30,
            traceId: 'trace-1',
          },
        },
      }).message,
    ).toBe('status=500; responseKeys=retryAfter,traceId');

    expect(
      summarizeKeycloakFailure({
        isAxiosError: true,
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:18080',
      }).dedupeKey,
    ).toBe('status=none|axiosCode=ECONNREFUSED|message=connect ECONNREFUSED 127.0.0.1:18080');
  });

  it('handles plain errors, primitives, blank response data, and long values', () => {
    expect(summarizeKeycloakFailure(new Error('client_secret=hidden')).message).toBe(
      'message=client_secret=[redacted]',
    );
    expect(summarizeKeycloakFailure('failed').dedupeKey).toBe('error=failed');
    expect(
      summarizeKeycloakFailure({
        isAxiosError: true,
        response: {
          status: 418,
          data: 418,
        },
      }).message,
    ).toBe('status=418');
    expect(
      summarizeKeycloakFailure({
        isAxiosError: true,
        response: {
          status: 401,
          data: {
            password: 'hidden',
          },
        },
      }).message,
    ).toBe('status=401');

    const longValue = 'a'.repeat(350);
    const longSummary = summarizeKeycloakFailure(new Error(longValue));
    expect(longSummary.message).toBe(`message=${'a'.repeat(300)}...`);
  });
});
