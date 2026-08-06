# Status

## Current State

- Investigated preview gateway logs and traced the failure to Nginx upstream header buffering during auth session refresh.
- Confirmed the Railway gateway config lacks proxy buffer tuning.
- Confirmed `#4016` changed Railway preview/test execution in a way that likely exposed the latent bug.
- Added explicit proxy buffer sizing to the Railway gateway to handle larger auth refresh response headers.

## Decisions

- Fix only the Railway gateway in this patch to minimize scope and directly address the failing preview/CI path.

## Next Steps

- Commit and open a PR.
- Monitor CI to confirm the fix resolves the gateway error.
