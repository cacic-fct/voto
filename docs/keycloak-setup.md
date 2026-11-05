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

Add an Audience mapper to the client's dedicated scope with Included Client
Audience `cacic-voto`, Add to access token enabled, Add to token introspection
enabled, and Add to ID token disabled. Incoming M2M tokens must also include
`cacic-voto` in their audience. The backend verifies the JWT signature and time
claims, then requires Keycloak introspection to return `active: true` before
caching the principal. Provider failures reject authentication; local voting
subject revocation checks still apply.

## Admin access

The `super-admin` realm role or the same role on the configured
`KEYCLOAK_CLIENT_ID` grants full access to `Área restrita`. The
`election-observer` role in either location grants read-only access to the
eligible CACiC elections. The `access` role alone grants no workspace privileges.

For scoped access, define client roles on `KEYCLOAK_CLIENT_ID` with the exact
permission names below. Keycloak can assign these roles directly or through a
group or composite role.

- `poll#read` lists and opens polls in the workspace.
- `poll#create`, `poll#edit`, `poll#delete`, and `poll#publish` grant the
  corresponding write operations.
- `poll#kiosk` grants kiosk access and ballot authorization.

Include the role claims in the access token or enable **Add to token
introspection** on their protocol mappers. CACiC Voto evaluates these roles
directly from Keycloak. Account Manager can schedule and synchronize role
assignments to Keycloak. Voto authorization requires no Account Manager call
or shared database. After changing role assignments, sign in again to obtain a
token with the updated roles.

If you use Keycloak Authorization Services, configure the `poll` resource and
its scopes on the voting client. The backend evaluates those policies for
permissions absent from the session's claims.

## Machine-to-machine client

Create a second confidential client for backend-to-backend calls:

- Client ID: `cacic-voto-m2m`
- Service accounts: enabled
- Standard flow: disabled
- Direct access grants: disabled

Copy its secret into `KEYCLOAK_M2M_CLIENT_SECRET`. Grant the service account:

- Event Manager access for `/internal/voting/events` and attendance checks.
- Account Manager `users:read` on `cacic-account-manager-audience` for fresh Keycloak user lookups.
- Account Manager `totp:validate` on `cacic-account-manager-audience` for kiosk voter authorization. Do not grant `totp:relay`.

In local development, use:

```bash
EVENT_MANAGER_M2M_AUDIENCE="cacic-event-manager-api"
ACCOUNT_MANAGER_M2M_AUDIENCE="cacic-account-manager-audience"
POLL_KIOSK_AUTHORIZATION_TTL_SECONDS="600"
POLL_KIOSK_ATTEMPT_WINDOW_SECONDS="300"
POLL_KIOSK_SESSION_ATTEMPT_LIMIT="5"
POLL_KIOSK_GLOBAL_EMAIL_ATTEMPT_LIMIT="15"
```

## Environment

Use `.env.example` as the source of truth for variable names. At minimum configure:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cacic_voto"
REDIS_URL="redis://localhost:6379/0"
KEYCLOAK_REALM_URL="https://sso.cacic.com.br/realms/cacic-sso"
KEYCLOAK_CLIENT_ID="cacic-voto"
KEYCLOAK_CLIENT_SECRET="..."
KEYCLOAK_REDIRECT_URI="http://localhost:4200/api/auth/callback"
KEYCLOAK_POST_LOGIN_REDIRECT_URI="http://localhost:4200"
KEYCLOAK_POST_LOGOUT_REDIRECT_URI="http://localhost:4200/"
KEYCLOAK_M2M_CLIENT_ID="cacic-voto-m2m"
KEYCLOAK_M2M_CLIENT_SECRET="..."
EVENT_MANAGER_GRPC_URL="localhost:50052"
EVENT_MANAGER_M2M_AUDIENCE="cacic-event-manager-api"
ACCOUNT_MANAGER_GRPC_URL="localhost:50053"
ACCOUNT_MANAGER_M2M_AUDIENCE="cacic-account-manager-audience"
```

Start Postgres and Redis with Docker Compose, then run Prisma migrations only after confirming the target database:

```bash
docker compose up -d postgres redis
bunx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```
