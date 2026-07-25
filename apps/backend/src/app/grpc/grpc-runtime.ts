import {
  ChannelCredentials,
  Client,
  type Metadata,
  type MethodDefinition,
  type ServiceDefinition,
  status,
} from '@grpc/grpc-js';
import { loadPackageDefinition, type GrpcObject } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type UnknownMethod = MethodDefinition<unknown, unknown>;
const TRANSIENT_CODES = new Set([status.UNAVAILABLE, status.DEADLINE_EXCEEDED, status.RESOURCE_EXHAUSTED]);

export function loadService(fileName: string, packageSegments: string[], serviceName: string): ServiceDefinition {
  const configuredRoot = process.env.CACIC_GRPC_PROTO_ROOT?.trim();
  const candidates = [
    ...(configuredRoot ? [join(configuredRoot, fileName)] : []),
    join(__dirname, 'assets', 'grpc', fileName),
    join(process.cwd(), 'src', 'assets', 'grpc', fileName),
    join(process.cwd(), 'apps', 'backend', 'src', 'assets', 'grpc', fileName),
  ];
  const protoPath = candidates.find((candidate) => existsSync(candidate));
  if (!protoPath) throw new Error(`Could not find gRPC contract ${fileName}.`);
  const definition = loadSync(protoPath, {
    defaults: false,
    enums: String,
    keepCase: false,
    longs: String,
    oneofs: true,
  });
  let current: GrpcObject | undefined = loadPackageDefinition(definition);
  for (const segment of packageSegments) {
    const next: unknown = current?.[segment];
    if (typeof next !== 'object' || next === null) throw new Error(`Missing gRPC package in ${protoPath}.`);
    current = next as GrpcObject;
  }
  const service = current[serviceName] as { service?: ServiceDefinition } | undefined;
  if (!service?.service) throw new Error(`Missing gRPC service ${serviceName}.`);
  return service.service;
}

export class GrpcUnaryClient {
  private readonly client: Client;

  constructor(target: string, private readonly service: ServiceDefinition) {
    this.client = new Client(target, ChannelCredentials.createInsecure(), {
      'grpc.keepalive_time_ms': 60_000,
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 0,
    });
  }

  async call<T>(
    methodName: string,
    request: unknown,
    metadata: Metadata,
    options: { idempotent?: boolean; maxAttempts?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const method = this.method(methodName);
    const attempts = options.idempotent ? (options.maxAttempts ?? 3) : 1;
    const timeoutMs = options.timeoutMs ?? 30_000;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.client.waitForReady(Date.now() + timeoutMs, (error) => (error ? reject(error) : resolve()));
        });
        return await new Promise<T>((resolve, reject) => {
          this.client.makeUnaryRequest(
            method.path,
            method.requestSerialize,
            method.responseDeserialize,
            request,
            metadata,
            { deadline: Date.now() + timeoutMs },
            (error, response) => (error ? reject(error) : resolve(response as T)),
          );
        });
      } catch (error) {
        lastError = error;
        if (!this.shouldRetry(error, attempt, attempts)) throw error;
        const backoffMs = Math.min(100 * 2 ** (attempt - 1), 1_000);
        const jitteredBackoffMs = Math.round(backoffMs * (0.8 + Math.random() * 0.4));
        await new Promise((resolve) => setTimeout(resolve, jitteredBackoffMs));
      }
    }
    throw lastError;
  }

  close(): void {
    this.client.close();
  }

  private method(name: string): UnknownMethod {
    const method = Object.values(this.service).find(
      (candidate) => candidate.originalName === name || candidate.path.endsWith(`/${name}`),
    );
    if (!method) throw new Error(`Unknown gRPC method ${name}.`);
    return method;
  }

  private shouldRetry(error: unknown, attempt: number, attempts: number): boolean {
    if (attempt >= attempts || typeof error !== 'object' || error === null) return false;
    if ('code' in error && typeof error.code === 'number') return TRANSIENT_CODES.has(error.code);
    return error instanceof Error && /failed to connect|before the deadline/i.test(error.message);
  }
}
