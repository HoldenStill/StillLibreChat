import { SystemRoles } from 'librechat-data-provider';
import { logger, runAsSystem } from '@librechat/data-schemas';
import { getSafeErrorMetadata } from '~/utils/errors';
import { isEnabled } from '~/utils/common';

export const PROXY_IDENTITY_HEADERS = [
  'tailscale-user-login',
  'x-forwarded-user',
  'x-webauth-user',
] as const;

export type ProxyIdentityHeaderName = (typeof PROXY_IDENTITY_HEADERS)[number];

export interface ProxyAuthUser {
  _id?: { toString(): string } | string;
  id?: string;
  email?: string;
  username?: string;
  name?: string;
  role?: string;
  provider?: string;
  tenantId?: string;
  idOnTheSource?: string | null;
  agentTriggerDeletionStartedAt?: Date | string | null;
  [key: string]: unknown;
}

export interface ProxyAuthConfig {
  enabled?: boolean;
  adminEmail?: string;
}

export interface ProxyHeaderAuthDeps {
  findUser: (
    searchCriteria: Record<string, unknown>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<ProxyAuthUser | null>;
}

export type ProxyHeaderIdentityResult =
  | {
      authenticated: true;
      user: ProxyAuthUser;
      headerName: ProxyIdentityHeaderName;
      identity: string;
    }
  | {
      authenticated: false;
      reason: 'disabled' | 'no_header' | 'invalid_identity' | 'user_not_found' | 'error';
    };

const PROXY_USER_PROJECTION =
  '-password -__v -totpSecret -backupCodes -pendingTotpSecret -pendingBackupCodes -federatedTokens';

function extractProxyIdentityHeader(
  headers?: Record<string, string | string[] | undefined>,
): { headerName: ProxyIdentityHeaderName; rawValue: string } | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  for (const headerName of PROXY_IDENTITY_HEADERS) {
    const val = headers[headerName] ?? headers[headerName.toLowerCase()];
    const str = Array.isArray(val) ? val[0] : val;
    if (typeof str === 'string' && str.trim().length > 0) {
      return { headerName, rawValue: str.trim() };
    }
  }
  return null;
}

function isValidIdentityValue(value: string): boolean {
  if (!value || value.length > 320) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves an authenticated LibreChat user from trusted reverse-proxy identity headers
 * (`Tailscale-User-Login`, `X-Forwarded-User`, `X-Webauth-User`) when `TRUST_PROXY_AUTH=true`.
 */
export async function resolveProxyHeaderIdentity(
  req: {
    headers?: Record<string, string | string[] | undefined>;
    config?: { proxyAuth?: ProxyAuthConfig };
  },
  deps: ProxyHeaderAuthDeps,
  configOverride?: ProxyAuthConfig,
): Promise<ProxyHeaderIdentityResult> {
  const effectiveEnabled =
    configOverride?.enabled ??
    req.config?.proxyAuth?.enabled ??
    isEnabled(process.env.TRUST_PROXY_AUTH);

  if (!effectiveEnabled) {
    return { authenticated: false, reason: 'disabled' };
  }

  const extracted = extractProxyIdentityHeader(req.headers);
  if (!extracted) {
    return { authenticated: false, reason: 'no_header' };
  }

  const identity = extracted.rawValue.toLowerCase();
  if (!isValidIdentityValue(identity)) {
    return { authenticated: false, reason: 'invalid_identity' };
  }

  const configuredAdminEmail = (
    configOverride?.adminEmail ??
    req.config?.proxyAuth?.adminEmail ??
    process.env.PROXY_AUTH_ADMIN_EMAIL ??
    ''
  )
    .trim()
    .toLowerCase();

  try {
    const user = await runAsSystem(async () => {
      if (identity.includes('@')) {
        const byEmail = await deps.findUser({ email: identity }, PROXY_USER_PROJECTION);
        if (byEmail) {
          return byEmail;
        }
      } else {
        const byUsername = await deps.findUser({ username: identity }, PROXY_USER_PROJECTION);
        if (byUsername) {
          return byUsername;
        }
      }

      if (configuredAdminEmail && identity === configuredAdminEmail) {
        const adminByEmail = await deps.findUser(
          { email: configuredAdminEmail },
          PROXY_USER_PROJECTION,
        );
        if (adminByEmail) {
          return adminByEmail;
        }
        return await deps.findUser({ role: SystemRoles.ADMIN }, PROXY_USER_PROJECTION);
      }

      return null;
    });

    if (!user || user.agentTriggerDeletionStartedAt != null) {
      return { authenticated: false, reason: 'user_not_found' };
    }

    const isAdminUser = user.role === SystemRoles.ADMIN;
    const matchesConfiguredAdmin =
      configuredAdminEmail.length > 0 &&
      (user.email?.toLowerCase() === configuredAdminEmail || identity === configuredAdminEmail);

    if (!isAdminUser && !matchesConfiguredAdmin && configuredAdminEmail.length > 0) {
      return { authenticated: false, reason: 'user_not_found' };
    }

    const hydrated =
      typeof (user as { toObject?: () => ProxyAuthUser }).toObject === 'function'
        ? (user as { toObject: () => ProxyAuthUser }).toObject()
        : { ...user };

    let resolvedId: string | undefined;
    if (typeof hydrated._id === 'object' && hydrated._id != null) {
      resolvedId = hydrated._id.toString();
    } else if (typeof hydrated._id === 'string') {
      resolvedId = hydrated._id;
    } else {
      resolvedId = hydrated.id;
    }

    if (resolvedId) {
      hydrated.id = resolvedId;
    }
    hydrated.idOnTheSource ??= null;
    if (!hydrated.role) {
      hydrated.role = SystemRoles.USER;
    }

    return {
      authenticated: true,
      user: hydrated,
      headerName: extracted.headerName,
      identity,
    };
  } catch (err) {
    logger.error(
      '[resolveProxyHeaderIdentity] Failed to resolve proxy identity',
      getSafeErrorMetadata(err),
    );
    return { authenticated: false, reason: 'error' };
  }
}
