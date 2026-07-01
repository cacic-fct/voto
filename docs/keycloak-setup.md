# Keycloak setup

CACiC Voto uses Keycloak only for identity and authorization. Local auth sessions and OAuth authorization state are stored in Redis, while Postgres stores poll data and synced user profile metadata.

## Browser client

Create a confidential OpenID Connect client:

- Client ID: `cacic-voto`
- Client authentication: enabled
- Standard flow: enabled
- Direct access grants: disabled
- Valid redirect URIs:
  - `http://localhost:4200/api/auth/callback`
  - production app origin plus `/api/auth/callback`
- Valid post logout redirect URIs:
  - `http://localhost:4200/`
  - production app origin plus its deployed base href root
- Web origins:
  - `http://localhost:4200`
  - production app origin

Copy the generated client secret into `KEYCLOAK_CLIENT_SECRET`.

## Admin access

Users can access `Area restrita` when either of these is true:

- The token includes one of these roles: `admin`, `administrator`, `voting-admin`.
- The token or permission evaluation endpoint grants at least one poll permission:
  - `poll#read`
  - `poll#create`
  - `poll#edit`
  - `poll#delete`
  - `poll#publish`

Expose roles and permissions in tokens with Keycloak protocol mappers, or keep permissions in the sister authorization resource and let `/api/auth/permissions/evaluate` check them.

## Machine-to-machine client

Create a second confidential client for backend-to-backend calls:

- Client ID: `cacic-voto-m2m`
- Service accounts: enabled
- Standard flow: disabled
- Direct access grants: disabled

Copy its secret into `KEYCLOAK_M2M_CLIENT_SECRET`. Grant the service account:

- Event Manager access for `/internal/voting/events` and attendance checks.
- Account Manager `users:read` on `cacic-account-manager-audience` for fresh Keycloak user lookups.

In local development, use:

```bash
EVENT_MANAGER_M2M_AUDIENCE="cacic-event-manager-api"
ACCOUNT_MANAGER_M2M_AUDIENCE="cacic-account-manager-audience"
```

## Environment

Use `.env.example` as the source of truth for variable names. At minimum configure:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cacic_voto"
REDIS_URL="redis://localhost:6379/0"
KEYCLOAK_REALM_URL="https://sso.cacic.dev.br/realms/cacic-sso"
KEYCLOAK_CLIENT_ID="cacic-voto"
KEYCLOAK_CLIENT_SECRET="..."
KEYCLOAK_REDIRECT_URI="http://localhost:4200/api/auth/callback"
KEYCLOAK_POST_LOGIN_REDIRECT_URI="http://localhost:4200"
KEYCLOAK_POST_LOGOUT_REDIRECT_URI="http://localhost:4200/"
KEYCLOAK_M2M_CLIENT_ID="cacic-voto-m2m"
KEYCLOAK_M2M_CLIENT_SECRET="..."
EVENT_MANAGER_API_URL="http://localhost:3000/api"
EVENT_MANAGER_M2M_AUDIENCE="cacic-event-manager-api"
ACCOUNT_MANAGER_API_URL="http://localhost:3000/api"
ACCOUNT_MANAGER_M2M_AUDIENCE="cacic-account-manager-audience"
```

Start Postgres and Redis with Docker Compose, then run Prisma migrations only after confirming the target database:

```bash
docker compose up -d postgres redis
bunx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```
