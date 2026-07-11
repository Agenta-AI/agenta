# Status

## Current state

The design has been revised after owner and CodeRabbit review. No implementation code has
changed.

The broad NetBird recommendation is withdrawn. ACP already carries reverse application
requests, so permissions do not need a new network route. The only current direct
sandbox-to-Agenta infrastructure requirement is private S3 connectivity for durable
mounts.

## Decisions

- Do not build NetBird as a general sandbox transport.
- Do not replace ngrok with Cloudflare Quick Tunnels by default until geesefs qualification
  passes.
- Refactor mount orchestration around one sandbox-reachable store endpoint.
- Add bounded readiness, route probing, and fail-loud behavior for requested private
  mounts.
- Keep storage authentication separate from network reachability.
- Treat NetBird as a conditional private-store option.
- If NetBird is reopened, service exposure, per-run authentication, default-deny ACLs, and
  one-off setup-key handling belong in the first MVP.

## Review threads addressed

- Public SeaweedFS is network-exposed through the tunnel but still S3-authenticated.
- Quick Tunnel's 200 limit is concurrent in-flight requests; ngrok limits different
  dimensions.
- Mounting only needs an effective URL. Provider discovery moves behind endpoint
  resolution.
- Store behavior depends on endpoint topology, not production versus development.
- ACP already supports the permission request and response flow.
- The MCP matrix now distinguishes Pi relay tools, user HTTP MCP, and runner-loopback MCP.
- Dynamic tunnel readiness now has retry and fail-loud acceptance criteria.
- NetBird topology now names the required peer, route, or proxy.
- Default-deny and port-scoped ACLs moved into the first possible MVP.
- Setup keys no longer ride sandbox environment variables.
- Multipart S3 qualification is a rollout gate for Quick Tunnels.

## Remaining work

1. Review this revised decision.
2. Implement the provider-neutral endpoint resolver and fail-loud readiness as a separate
   approved change.
3. Run the Quick Tunnel multipart and concurrency experiment.
4. Choose the supported store connectivity option from measured results.
5. Open a new NetBird project only if the decision gate in [plan.md](plan.md) passes.

## Provenance

- PR: #5219.
- Owner review: comments beginning at #discussion_r3564405773.
- Requested anchor: #discussion_r3564426767.
- Research: three parallel tracks covering ACP and transport direction, storage and tunnel
  behavior, and MCP plus NetBird security.
- Related corrected root cause: PR #5218.
