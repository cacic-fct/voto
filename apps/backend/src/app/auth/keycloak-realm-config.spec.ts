import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RealmEntry = {
  clientId?: string;
  name?: string;
  protocolMappers?: {
    protocolMapper: string;
    config: Record<string, string>;
  }[];
};

const realm = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../docker/keycloak/cacic-sso-realm.json'), 'utf8'),
) as { clients: RealmEntry[]; clientScopes: RealmEntry[] };

describe('Keycloak realm introspection audience', () => {
  it.each([
    { name: 'cacic-voto login', audience: 'cacic-voto', entry: realm.clients.find((client) => client.clientId === 'cacic-voto') },
  ])('includes the receiving backend in tokens from $name', ({ audience, entry }) => {
    expect(entry?.protocolMappers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocolMapper: 'oidc-audience-mapper',
          config: expect.objectContaining({
            'included.client.audience': audience,
            'access.token.claim': 'true',
            'id.token.claim': 'false',
          }),
        }),
      ]),
    );
  });
});
