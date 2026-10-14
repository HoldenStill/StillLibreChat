import { resolveProxyHeaderIdentity } from '../headerAuth';

describe('Tailscale / Reverse-Proxy Identity Header Auth (Feature 4)', () => {
  it('returns disabled when TRUST_PROXY_AUTH is not enabled', async () => {
    const findUser = jest.fn();
    const res = await resolveProxyHeaderIdentity(
      { headers: { 'tailscale-user-login': 'alice@example.com' } },
      { findUser },
      { enabled: false },
    );
    expect(res.authenticated).toBe(false);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('authenticates matching user from Tailscale-User-Login when TRUST_PROXY_AUTH=true', async () => {
    const mockUser = { _id: 'u1', email: 'alice@example.com', role: 'ADMIN' };
    const findUser = jest.fn(async (criteria: Record<string, unknown>) => {
      if (criteria.email === 'alice@example.com') {
        return mockUser;
      }
      return null;
    });

    const res = await resolveProxyHeaderIdentity(
      { headers: { 'tailscale-user-login': 'Alice@Example.com' } },
      { findUser },
      { enabled: true },
    );

    expect(res.authenticated).toBe(true);
    if (res.authenticated) {
      expect(res.headerName).toBe('tailscale-user-login');
      expect(res.identity).toBe('alice@example.com');
      expect(res.user.id).toBe('u1');
    }
  });

  it('authenticates configured PROXY_AUTH_ADMIN_EMAIL account', async () => {
    const adminUser = { _id: 'admin-1', email: 'admin@homelab.local', role: 'USER' };
    const findUser = jest.fn(async (criteria: Record<string, unknown>) => {
      if (criteria.email === 'admin@homelab.local') {
        return adminUser;
      }
      return null;
    });

    const res = await resolveProxyHeaderIdentity(
      { headers: { 'x-forwarded-user': 'admin@homelab.local' } },
      { findUser },
      {
        enabled: true,
        adminEmail: 'admin@homelab.local',
      },
    );

    expect(res.authenticated).toBe(true);
    if (res.authenticated) {
      expect(res.user.id).toBe('admin-1');
    }
  });
});
