# Research

## Observations

- `hosting/railway/oss/gateway/nginx.conf` has no `proxy_buffer_size`, `proxy_buffers`, or `proxy_busy_buffers_size` directives.
- The error occurs while reading response headers from `/api/auth/session/refresh`, which strongly suggests an oversized upstream header, typically `Set-Cookie`.
- `hosting/railway/oss/gateway/nginx.conf` was introduced without these directives and has not previously contained them.
- `#4016` added a unified Railway test workflow and auth bootstrap path that makes session refresh traffic happen early and reliably.
- `hosting/railway/oss/scripts/preview-resolve-env.sh` defaults preview deployments to a Railway environment named `production`, which explains `gateway-production-*.up.railway.app` preview domains.

## Working Theory

The root product bug is missing Nginx proxy header buffer tuning in the Railway gateway. The CI/workflow changes in `#4016` exposed it by driving requests through `/api/auth/session/refresh` more often.

## Candidate Fix

Set explicit proxy buffer sizes in the Railway gateway `server` block, near the existing timeout directives, so larger auth refresh headers fit without overflowing default buffers.

Suggested values:
- `proxy_buffer_size 16k`
- `proxy_buffers 4 16k`
- `proxy_busy_buffers_size 16k`

These values are conservative, common for auth-heavy apps, and should be sufficient for large cookie headers without materially changing routing behavior.
