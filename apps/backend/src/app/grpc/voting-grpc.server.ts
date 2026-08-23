import {
  Metadata,
  Server,
  ServerCredentials,
  status,
  type handleUnaryCall,
  type sendUnaryData,
  type ServerUnaryCall,
  type ServiceError,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
  type INestApplication,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { KeycloakAuthService } from '../auth/keycloak-auth.service';
import { VotingLgpdService } from '../lgpd/voting-lgpd.service';
import { loadService } from './grpc-runtime';

type GrpcRequest = Record<string, unknown>;
type GrpcResponse = Record<string, unknown>;
type VotingGrpcDependencies = {
  auth: KeycloakAuthService;
  lgpd: VotingLgpdService;
};

const logger = new Logger('VotingGrpc');

@Injectable()
export class VotingGrpcServerLifecycle implements OnApplicationShutdown {
  private server: Server | undefined;

  register(server: Server): void {
    this.server = server;
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;
    await shutdownVotingGrpcServer(this.server);
    this.server = undefined;
  }
}

export async function startVotingGrpcServer(app: INestApplication): Promise<Server> {
  const server = new Server({
    'grpc.max_receive_message_length': 4 * 1024 * 1024,
    'grpc.max_send_message_length': 4 * 1024 * 1024,
  });
  const service = loadService(
    'cacic/m2m/event_manager/v1/event-manager-m2m.proto',
    ['cacic', 'm2m', 'event_manager', 'v1'],
    'EventManagerM2M',
  );

  server.addService(
    service,
    createVotingGrpcHandlers({
      auth: app.get(KeycloakAuthService),
      lgpd: app.get(VotingLgpdService),
    }),
  );

  const bindUrl = process.env.VOTING_GRPC_BIND_URL?.trim() || '0.0.0.0:50051';
  app.get(VotingGrpcServerLifecycle).register(server);
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(bindUrl, ServerCredentials.createInsecure(), (error) => (error ? reject(error) : resolve()));
  });
  logger.log(`CACiC Voto LGPD gRPC server is listening on ${bindUrl}.`);
  return server;
}

export async function shutdownVotingGrpcServer(server: Server): Promise<void> {
  const timeoutMs = parsePositiveIntegerEnv(process.env.VOTING_GRPC_SHUTDOWN_TIMEOUT_MS, 10_000);
  let settled = false;
  let resolveShutdown: (() => void) | undefined;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    server.tryShutdown(() => resolveShutdown?.());
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, timeoutMs);
    timeoutHandle.unref?.();
  });
  try {
    await Promise.race([shutdown, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
  if (!settled) {
    server.forceShutdown();
    resolveShutdown?.();
  }
}

function parsePositiveIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const value = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createVotingGrpcHandlers(dependencies: VotingGrpcDependencies): UntypedServiceImplementation {
  return {
    collectLgpdUserData: unary(async (call) => {
      await authorize(call.metadata, dependencies.auth, ['lgpd:read']);
      return { json: JSON.stringify(await dependencies.lgpd.collectUserData(lgpdUserInput(call.request))) };
    }),
    scheduleLgpdDeletion: unary(async (call) => {
      await authorize(call.metadata, dependencies.auth, ['lgpd:delete']);
      return { json: JSON.stringify(await dependencies.lgpd.scheduleDeletion(lgpdDeletionInput(call.request))) };
    }),
    cancelLgpdDeletion: unary(async (call) => {
      await authorize(call.metadata, dependencies.auth, ['lgpd:delete']);
      return { json: JSON.stringify(await dependencies.lgpd.cancelDeletion(lgpdDeletionInput(call.request))) };
    }),
    deleteLgpdData: unary(async (call) => {
      await authorize(call.metadata, dependencies.auth, ['lgpd:delete']);
      return { json: JSON.stringify(await dependencies.lgpd.hardDelete(lgpdDeletionInput(call.request))) };
    }),
  };
}

function unary(
  handler: (call: ServerUnaryCall<GrpcRequest, GrpcResponse>) => Promise<GrpcResponse>,
): handleUnaryCall<GrpcRequest, GrpcResponse> {
  return (call: ServerUnaryCall<GrpcRequest, GrpcResponse>, callback: sendUnaryData<GrpcResponse>) => {
    void handler(call).then(
      (response) => callback(null, response),
      (error: unknown) => callback(toServiceError(error), null),
    );
  };
}

async function authorize(metadata: Metadata, auth: KeycloakAuthService, requiredRoles: readonly string[]): Promise<void> {
  const raw = metadata.get('authorization')[0];
  const header = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing gRPC authorization metadata.');
  }
  await auth.authenticateMachineToMachineToken(
    header.slice('Bearer '.length),
    requiredRoles,
    allowedLgpdM2mClients(),
  );
}

function allowedLgpdM2mClients(): string[] {
  const configured = process.env.LGPD_M2M_ALLOWED_CLIENTS ?? 'cacic-account-manager-m2m';
  return configured.split(',').map((clientId) => clientId.trim()).filter(Boolean);
}

function lgpdUserInput(request: GrpcRequest): { userId: string; email?: string } {
  return {
    userId: requiredString(request, 'userId'),
    ...optionalStringFields(request, ['email']),
  };
}

function lgpdDeletionInput(request: GrpcRequest): { requestId: string; userId: string; email?: string } {
  return {
    requestId: requiredString(request, 'requestId'),
    ...lgpdUserInput(request),
  };
}

function requiredString(value: GrpcRequest, key: string): string {
  const raw = value[key];
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException(`${key} is required.`);
  }
  const normalized = raw.trim();
  const maxLength = key === 'requestId' ? 128 : 256;
  if (normalized.length > maxLength || containsControlCharacters(normalized)) {
    throw new BadRequestException(`${key} is invalid.`);
  }
  if (key === 'requestId' && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new BadRequestException('requestId is invalid.');
  }
  return normalized;
}

function optionalStringFields<T extends readonly string[]>(
  value: GrpcRequest,
  keys: T,
): Partial<Record<T[number], string>> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const raw = value[key];
      if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
        return [];
      }
      if (typeof raw !== 'string') {
        throw new BadRequestException(`${key} is invalid.`);
      }
      const normalized = raw.trim();
      if (normalized.length > 320 || containsControlCharacters(normalized)) {
        throw new BadRequestException(`${key} is invalid.`);
      }
      if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new BadRequestException('email is invalid.');
      }
      return [[key, normalized]];
    }),
  ) as Partial<Record<T[number], string>>;
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function toServiceError(error: unknown): ServiceError {
  const code = error instanceof HttpException ? grpcStatusForHttpStatus(error.getStatus()) : status.INTERNAL;
  const details = error instanceof HttpException ? error.message : 'Internal gRPC service error.';
  return Object.assign(new Error(details), { code, details, metadata: new Metadata() });
}

function grpcStatusForHttpStatus(httpStatus: number): status {
  const byStatus: Readonly<Record<number, status>> = {
    [HttpStatus.BAD_REQUEST]: status.INVALID_ARGUMENT,
    [HttpStatus.UNAUTHORIZED]: status.UNAUTHENTICATED,
    [HttpStatus.FORBIDDEN]: status.PERMISSION_DENIED,
    [HttpStatus.NOT_FOUND]: status.NOT_FOUND,
    [HttpStatus.CONFLICT]: status.ALREADY_EXISTS,
    [HttpStatus.REQUEST_TIMEOUT]: status.DEADLINE_EXCEEDED,
    [HttpStatus.GATEWAY_TIMEOUT]: status.DEADLINE_EXCEEDED,
    [HttpStatus.SERVICE_UNAVAILABLE]: status.UNAVAILABLE,
  };
  return byStatus[httpStatus] ?? status.INTERNAL;
}
