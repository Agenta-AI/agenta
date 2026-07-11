# Recommendation

## Verdict

Feasible and documented. Daytona's own docs treat VPN clients inside sandboxes, NetBird
included, as a supported first-class flow with SDK examples
([Daytona VPN connections](https://www.daytona.io/docs/en/vpn-connections/#netbird)). The
remaining work before committing to a build is a short confirmation run in our own stack, not
a go/no-go spike on an unknown. After the confirmation, this is a build-decision question
(priority against the roadmap), not a feasibility question.

## What the confirmation run must show

Daytona documents the flow but does not document the container's capability set, gives no
ACL guidance, and says nothing about performance or its own egress policy. So confirm in our
stack, about one day:

1. Bake the NetBird client into a test Daytona snapshot next to Pi and geesefs (the
   documented per-run install works too, but costs seconds per run).
2. Mint an ephemeral setup key and join one sandbox non-interactively
   (`sudo netbird up --setup-key ...`, per the Daytona page).
3. Verify kernel mode: the WireGuard interface exists (`ip addr`, `netbird status`), no
   userspace fallback needed.
4. Verify both directions: the runner dials the sandbox daemon at its overlay address, and a
   sandbox process (geesefs against the store port) dials the runner at its overlay address.
5. Measure join time and round-trip latency against the current preview-proxy and ngrok
   paths.
6. Check the interaction with a restricted Daytona egress policy (`networkAllowList`), since
   the docs are silent on it.

If kernel mode fails on our tier, NetBird's userspace (netstack) mode is the fallback; it
runs with no capabilities but proxies specific ports instead of giving a transparent
interface, and it is slower. Detail in `research.md`, Question 1.

## What it would replace

- The ngrok tunnel for remote store mounts, the `with-tunnel` compose profile,
  `discoverTunnelEndpoint`, and the public-store requirement (F-017).
- Later, the file-relay gate channel that the F-018 fix adds now (Option B), by making the
  ACP reverse permission RPC work over a direct channel (Option A, which the F-018 project
  deferred as unfixable over the Daytona proxy).
- Later, the MCP loopback swap on Daytona and the planned in-sandbox MCP shim.

## What it must not block

The F-018 fix is being implemented now and stays the near-term answer. Nothing here changes
that. The relationship:

- Option C of that fix (precompute builtin allow/deny on the runner, resolve in-sandbox with
  no round-trip) is complementary and permanent. Keep it regardless.
- Option B of that fix (carry the gate over the polled file relay) is the near-term bridge
  the overlay could later retire. It is not throwaway: it ships the fix ahead of the overlay,
  and it is a small channel to remove later.

Build the F-018 fix as planned. Frame NetBird as the possible longer-term transport.

## Phases after the confirmation run (estimates UNVERIFIED)

- Phase 1, about 1 week: MVP behind a flag, Daytona only, default off. Per-run ephemeral key
  minting in the runner, injected into the sandbox env; join on boot; route the store mount
  over the overlay and drop ngrok on that path. NetBird cloud as the control plane first.
- Phase 2, 1 to 2 weeks: production hardening. Default-deny ACL generated per run, per-run
  groups, key and peer revocation on teardown, fail-loud when the overlay does not come up,
  observability, the self-hosted control-plane option, and self-hosting docs.

## Cloudflare Tunnel (the near-term mounts fix, separate from the overlay)

Adopt TryCloudflare quick tunnels as the default dev and self-host tunnel for the store
mount path, keeping ngrok as an alternative for anyone who already holds a token. A quick
tunnel needs no account and no token, which removes exactly the F-017 failure mode (no
`NGROK_AUTHTOKEN`, tunnel down, zombie mounts). It trades away any SLA and is explicitly not
for production, which is acceptable because the tunnel path itself is a dev and self-host
workaround; Agenta Cloud's store is genuinely public and uses no tunnel. Integration is 1 to
2 days (**UNVERIFIED**): a `cloudflared` compose service under the existing `with-tunnel`
profile and a second discovery branch in `mount.ts` against cloudflared's `/quicktunnel`
metrics endpoint (verified in cloudflared source). Everything added is deleted wholesale when
the overlay lands, and the overlay is far enough out that the interim fix pays for itself.
Full analysis in `research.md`, last section.

## Local mode

Leave local as-is. Local sandboxes share the docker network with the runner and need no
overlay. Make the overlay a remote-sandbox transport, gated on the Daytona path. See the
local mode section in `research.md`.

## Alternatives considered

NetBird over Tailscale (Tailscale is equally feasible per the same Daytona page, but its
control plane is proprietary SaaS with per-user pricing that fits ephemeral machine peers
poorly; NetBird self-hosts the whole control plane as one open-source project). Both over
plain WireGuard (which would make us rebuild the management plane). Any of them over keeping
per-feature tunnels (whose count grows with each new sandbox-to-runner need). Detail in
`research.md`, Question 5.
