import { Logger } from '@nestjs/common';

export function logBackendError(
  message: string,
  error: unknown,
  context: string,
): void {
  const trace =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  Logger.error(message, trace, context);
}
