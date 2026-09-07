export const DEFAULT_POST_LOGIN_APPLICATION_ORIGIN = 'https://voto.cacic.local';

type PostLoginRedirectOptions = {
  allowedOrigins: ReadonlySet<string>;
  applicationOrigin?: string;
};

/**
 * Normalize a post-login destination before it is persisted in OAuth state.
 * Relative paths are resolved against a fixed application origin so WHATWG
 * URL backslash and dot-segment normalization cannot change their authority
 * after validation. Absolute destinations remain a separate, allowlisted
 * flow.
 */
export function normalizePostLoginRedirect(
  value: string | undefined,
  options: PostLoginRedirectOptions,
): string | undefined {
  const redirect = value?.trim();
  if (!redirect || hasUnsafeRedirectCharacters(redirect)) {
    return undefined;
  }

  if (redirect.startsWith('//')) {
    return undefined;
  }

  const applicationOrigin = normalizeApplicationOrigin(options.applicationOrigin);
  const isRelativePath = redirect.startsWith('/');

  if (isRelativePath) {
    try {
      const url = new URL(redirect, applicationOrigin);
      if (url.origin !== applicationOrigin || !isAllowedAppPath(url.pathname)) {
        return undefined;
      }

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return undefined;
    }
  }

  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    !options.allowedOrigins.has(url.origin) ||
    !isAllowedAppPath(url.pathname)
  ) {
    return undefined;
  }

  return url.toString();
}

export function isAllowedAppPath(pathname: string): boolean {
  return pathname !== '/api/auth' && !pathname.startsWith('/api/auth/');
}

function hasUnsafeRedirectCharacters(value: string): boolean {
  // URL parsing strips or canonicalizes some controls, so reject them before
  // constructing a URL. Encoded separators/control bytes are rejected for the
  // same reason: a proxy or browser may decode them at a later hop.
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f|8[0-9a-f]|9[0-9a-f])/iu.test(value);
}

function normalizeApplicationOrigin(value?: string): string {
  if (!value) {
    return DEFAULT_POST_LOGIN_APPLICATION_ORIGIN;
  }

  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.origin;
    }
  } catch {
    // Fall through to the fixed local origin.
  }

  return DEFAULT_POST_LOGIN_APPLICATION_ORIGIN;
}
