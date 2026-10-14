# Tailscale & Reverse-Proxy Identity-Based Header Authentication (SSO)

This document provides the complete setup and security guide for passwordless reverse-proxy authentication using Tailscale Serve / Nginx identity headers.

---

## 1. Overview

When `TRUST_PROXY_AUTH=true` is enabled in the environment, LibreChat inspects incoming HTTP requests for trusted reverse-proxy identity headers:
1. `Tailscale-User-Login`
2. `X-Forwarded-User`
3. `X-Webauth-User`

When a valid identity header is present and resolves to an existing LibreChat user (or the configured `PROXY_AUTH_ADMIN_EMAIL`), LibreChat automatically authenticates both:
- **`POST /api/auth/refresh`** (issuing a fresh session + JWT access token on initial page load so the React frontend never renders the login wall), and
- **`requireJwtAuth`** (`api/server/middleware/requireJwtAuth.js`) for direct API calls carrying the proxy header.

When the headers are absent (for example, direct LAN access without the reverse proxy), LibreChat falls back gracefully to standard email/password or OAuth authentication.

---

## 2. Environment Variables

Add the following variables to your `.env` file:

```dotenv
# Enable reverse-proxy / Tailscale header SSO authentication
TRUST_PROXY_AUTH=true

# Optional: Map any authenticated proxy user (or specific admin email) to an existing LibreChat account
PROXY_AUTH_ADMIN_EMAIL=admin@example.com
```

### Resolution Logic (`packages/api/src/auth/headerAuth.ts`)
1. If `TRUST_PROXY_AUTH` is not `true` or `1`, the middleware is a no-op.
2. Inspects `Tailscale-User-Login`, `X-Forwarded-User`, and `X-Webauth-User` in priority order.
3. Looks up a user in MongoDB whose `email` or `username` matches the header value.
4. If no direct match is found and `PROXY_AUTH_ADMIN_EMAIL` is configured, resolves the user account matching `PROXY_AUTH_ADMIN_EMAIL`.

---

## 3. Reverse-Proxy Configuration Examples

> [!CAUTION]
> Only enable `TRUST_PROXY_AUTH=true` when LibreChat is behind a reverse proxy that strips client-supplied identity headers, or when port `3080` is bound exclusivamente to loopback (`127.0.0.1:3080:3080`) / your Tailscale interface.

### 3.1 Tailscale Serve / Funnel + Nginx
When using `tailscale serve` or Nginx in front of LibreChat, ensure Nginx overwrites identity headers from the upstream Tailscale socket:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.tailnet-name.ts.net;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;

        # Forward standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Forward Tailscale / WebAuth identity header (overwrite any client-spoofed header)
        proxy_set_header Tailscale-User-Login $http_tailscale_user_login;
        proxy_set_header X-Forwarded-User $remote_user;

        # SSE streaming support
        proxy_buffering off;
        proxy_cache off;
    }
}
```

### 3.2 Authelia / Authentik / Caddy ForwardAuth
If using Caddy or Traefik with ForwardAuth (which sets `X-Forwarded-User` or `X-Webauth-User`):

```caddyfile
chat.example.com {
    forward_auth authelia:9091 {
        uri /api/verify?rd=https://auth.example.com
        copy_headers Remote-User>X-Forwarded-User
    }
    reverse_proxy librechat:3080
}
```
