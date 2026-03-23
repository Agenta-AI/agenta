# Context

## Background

Railway preview and CI traffic reaches the app through `hosting/railway/oss/gateway/nginx.conf`.

After the Railway CI refactor in `#4016`, preview deployments began exercising the auth bootstrap and session refresh path more consistently. The gateway logs now show:

`upstream sent too big header while reading response header from upstream`

for `POST /api/auth/session/refresh`.

## Problem Statement

The gateway uses Nginx defaults for upstream response header buffering. Session refresh responses can emit a large `Set-Cookie` header, which can overflow the default proxy header buffer and cause Nginx to fail the request before it reaches the client.

## Goals

- Increase Railway gateway proxy header buffering enough to handle auth refresh responses.
- Keep the fix scoped to the Railway gateway path that CI and previews use.
- Validate that the change is small, safe, and easy to reason about.

## Non-Goals

- Redesign auth/session payload size.
- Change preview environment naming or workflow wiring.
- Refactor non-Railway Nginx configs in the same patch unless needed for the fix.
