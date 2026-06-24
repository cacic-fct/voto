import {
  decodeJwtPayload,
  extractClientRoles,
  extractOidcScopes,
  extractPermissionClaims,
  extractPermissions,
  extractRealmRoles,
  extractRoles,
  isRecord,
  readNumberClaim,
  readStringClaim,
} from './keycloak-claims.utils';

function tokenWithPayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `header.${encoded}.signature`;
}

describe('keycloak claim utilities', () => {
  it('decodes JWT payloads and ignores malformed payloads', () => {
    expect(decodeJwtPayload(tokenWithPayload({ sub: 'user-1' }))).toEqual({ sub: 'user-1' });
    expect(decodeJwtPayload('not-a-jwt')).toEqual({});
    expect(decodeJwtPayload('header.not-json.signature')).toEqual({});
    expect(decodeJwtPayload(tokenWithPayload('not-a-record'))).toEqual({});
    expect(decodeJwtPayload(tokenWithPayload(['not', 'a', 'record']))).toEqual(['not', 'a', 'record']);
  });

  it('extracts distinct realm and client roles from multiple claim sources', () => {
    const roles = extractRoles(
      {
        realm_access: { roles: [' admin ', '', 'member'] },
        resource_access: {
          voting: { roles: ['poll-admin', 'member'] },
          ignored: { roles: [1, ''] },
        },
      },
      {
        realm_access: { roles: ['member', 'auditor'] },
        resource_access: null,
      },
    );

    expect(roles).toEqual(['admin', 'member', 'poll-admin', 'auditor']);
  });

  it('skips invalid client-role and realm-role structures', () => {
    const roles = new Set<string>();

    extractClientRoles(null, roles);
    extractClientRoles({ voting: { roles: 'admin' } }, roles);

    expect([...roles]).toEqual([]);
    expect(extractRealmRoles(null, 'invalid', { roles: [' valid ', 1] })).toEqual(['valid']);
  });

  it('extracts OIDC scopes from space separated scope claims', () => {
    expect(extractOidcScopes({ scope: 'openid  profile ' }, { scope: 'profile email' }, { scope: 10 })).toEqual([
      'openid',
      'profile',
      'email',
    ]);
  });

  it('extracts string and structured permissions', () => {
    const permissionSet = new Set<string>();

    extractPermissionClaims(
      [
        ' poll#read ',
        '',
        { rsname: 'poll', scopes: ['edit', '', 1] },
        { resource_name: 'result', scopes: ['read'] },
        { scopes: ['global'] },
        { rsname: 'ignored' },
        null,
      ],
      permissionSet,
    );

    expect([...permissionSet]).toEqual(['poll#read', 'poll#edit', 'result#read', 'global']);
    expect(extractPermissions({ permissions: ['a'] }, { authorization: { permissions: ['b'] } })).toEqual(['a', 'b']);

    const unchanged = new Set<string>(['existing']);
    extractPermissionClaims('invalid', unchanged);
    expect([...unchanged]).toEqual(['existing']);
  });

  it('reads primitive claims with type guards', () => {
    const claims = { sub: 'user-1', exp: 100, empty: '', numericText: '100' };

    expect(readStringClaim(claims, 'sub')).toBe('user-1');
    expect(readStringClaim(claims, 'exp')).toBeUndefined();
    expect(readNumberClaim(claims, 'exp')).toBe(100);
    expect(readNumberClaim(claims, 'numericText')).toBeUndefined();
    expect(isRecord(claims)).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('value')).toBe(false);
  });
});
