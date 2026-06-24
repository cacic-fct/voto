import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthSessionStoreService } from './auth-session-store.service';
import { AuthorizationStateService } from './authorization-state.service';
import { KeycloakAuthService } from './keycloak-auth.service';
import { KeycloakM2mTokenService } from './keycloak-m2m-token.service';
import { getRedisConnectionOptions } from './redis-connection';

@Module({
  controllers: [AuthController],
  providers: [
    AuthSessionStoreService,
    AuthorizationStateService,
    KeycloakAuthService,
    KeycloakM2mTokenService,
    {
      provide: Redis,
      useFactory: () => new Redis(getRedisConnectionOptions()),
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [KeycloakAuthService, KeycloakM2mTokenService],
})
export class AuthModule {}
