# Architectures: the solution space

Three independent choices define a bring-your-own-runner design: the **connectivity
direction**, the **packaging**, and the **credential model**. They compose freely, so
this file treats them as three axes rather than as monolithic "option A vs option B"
bundles, then names the two bundles worth building.

## Axis 1: connectivity direction

The backend initiates dispatch today (`POST /run` into the runner). A user's machine
sits behind NAT with no stable address. There are two ways out.

### 1a. Tunnel-in: keep the direction, add a tunnel

The runner stays an HTTP server. A tunnel (ngrok, cloudflared, or an Agenta-operated
relay) gives it a public HTTPS URL, which the backend stores and dials.

```
backend --POST /run--> https://xyz.ngrok.app --tunnel--> runner :8765
```

Pros:

- No code change on the dispatch path. The service already takes a runner URL
  (`AGENTA_RUNNER_INTERNAL_URL`); this generalizes it to per-project.
- ngrok and cloudflared terminate TLS for free.
- Shippable in days; ideal for validating the story.

Cons:

- A public endpoint now exists that accepts turn payloads carrying secrets. The
  pairing token becomes the only lock on the door, so it must be mandatory and the
  runner must reject unauthenticated `/run` unconditionally when not on loopback.
- Setup friction: the user installs and runs a second tool, and free-tier ngrok URLs
  change on every restart, which breaks the registration until re-paired.
- Held streaming connections (a turn can run minutes; a parked approval, longer) pass
  through infrastructure we do not control. Idle-connection drops become our support
  tickets.

### 1b. Dial-out: reverse the direction

The runner opens a persistent outbound connection to the cloud (WebSocket, or SSE plus
short POSTs) and authenticates once with its runner key. Dispatch rides that channel:
the cloud writes the `/run` payload down the connection the runner opened; the runner
streams events back up the same pipe. This is the model of GitHub Actions self-hosted
runners, Buildkite agents, and Cloudflare Tunnel itself.

```
runner --connect+auth--> cloud runner-broker
runner <--run payload--- broker <--dispatch-- agent service
runner ---events-------> broker ---stream---> agent service
```

Pros:

- No inbound port, no tunnel, no public endpoint, nothing to scan. Works on any
  network that allows outbound HTTPS, which is every network.
- The backend-to-runner credential disappears; the runner key authenticates the
  connection and everything after it.
- Presence for free: the broker knows the instant a runner disconnects, so "your
  runner is offline" is exact, and routing can fall back to the cloud runner
  immediately.

Cons:

- Real backend work: a broker component that holds connections, correlates dispatches
  to responses, and survives its own restarts. The agent service's dispatch call
  changes from "HTTP POST to a URL" to "hand to the broker."
- Long-lived connections at the cloud edge need infrastructure attention (load
  balancer idle timeouts, reconnect storms).

### Verdict on axis 1

Tunnel-in is the v0; dial-out is the destination. The `/run` payload and the event
stream stay byte-identical in both, so nothing built for the tunnel is thrown away
except the tunnel itself.

## Axis 2: packaging

### 2a. Bare process (no Docker)

`npx @agenta/runner` first, a compiled single binary later. The runner is already a
standalone pnpm package that runs under `tsx`, so the npx form is mostly publishing
work. A binary needs a bundling pass (esbuild already bundles the Pi extension) and
per-platform builds.

- Footprint: one idle Node process, roughly 100 to 200 MB RSS; harnesses spawn per
  run. A Bun-compiled binary would trim startup and remove the Node prerequisite.
- The agent operates on the user's real filesystem and can reuse their local logins
  (Claude/ChatGPT subscription auth, existing `~/.pi` state). This is the point of the
  user story.
- Licensing is respected: Pi (MIT) can be bundled; Claude Code is installed from
  Anthropic at first use, never redistributed by us.
- The trade-off is the same as the benefit: no isolation. The agent runs with the
  user's permissions. Our permission policy (allow/ask/deny) still gates tool calls,
  but nothing OS-level contains the harness.

### 2b. Docker

`docker run ghcr.io/agenta-ai/agenta-runner`, reusing the image the
sidecar-deployment proposal plans to publish anyway.

- Buys: host isolation (container filesystem, controllable mounts), pinned deps,
  clean teardown, and a natural fit for the "runner on my homelab server" user.
- Costs: Docker as a prerequisite, an image pull, a resident container, and losing
  the user's real filesystem and logins unless they explicitly mount them, at which
  point the isolation benefit mostly evaporates.
- Memory: comparable process footprint plus container overhead; the bigger cost is
  disk (image size) and setup ceremony.

### Verdict on axis 2

Bare process is the headline path because it matches the story (agent near the user's
code) and the simplicity goal. Publish the Docker image too; it costs little since the
deployment proposal builds it regardless, and it serves the server-hosted and
cautious-user segments.

## Axis 3: credential model

Two credentials are in play: what the runner presents to the cloud, and what the cloud
presents to the runner.

| Model | Runner → cloud | Cloud → runner | Assessment |
| --- | --- | --- | --- |
| **v0 pragmatic** | Existing project ApiKey (env fallback for OTLP already reads `AGENTA_API_KEY`) | Pairing token generated at registration, sent as the existing `AGENTA_RUNNER_TOKEN` bearer | Zero schema work. Over-privileged runner credential; acceptable behind a flag for design partners. |
| **Runner key** | New capability-scoped key (trace ingest, tool gateway, sessions plane only), bound to a runner registration row, revocable from the UI | Same pairing token, now stored on the registration row per runner instead of one global env var | The right v1. A scope column on `APIKeyDB` plus a middleware check, not a new auth system. |
| **Dial-out collapse** | Runner key authenticates the outbound connection; per-run `Secret` tokens keep riding inside payloads exactly as today | None needed; dispatch rides the runner-initiated channel | The end state. One credential, no public surface. |

Two rules hold in every model:

1. **A runner binds to exactly one project**, and the router only ever sends that
   project's runs to it. The `/run` payload can carry that project's vault secrets, so
   cross-project routing would be a secret leak, not just a bug.
2. **Prefer self-managed model auth on user-hosted runners** (the user's own provider
   key or subscription login). Then managed vault keys never leave the cloud at all,
   and the wire carries no provider secret. The clear-then-apply hygiene in the daemon
   already supports both modes.

## The two bundles worth building

**Bundle 1, "tunnel MVP":** tunnel-in + bare process + v0 credentials, upgraded to the
runner key as soon as the registration endpoint exists. This is Tiers 0 and 1 in
[plans.md](plans.md).

**Bundle 2, "native runner":** dial-out + compiled binary (Docker image as an
alternative) + the collapsed single-credential model. This is Tier 2. Everything from
Bundle 1 except the tunnel glue carries forward: the wire contract, the registration
model, the routing rule, the UI, and the runner key.

## Cross-cutting requirements either bundle must meet

- **Mandatory auth off loopback.** The runner refuses `/run` without its token whenever
  it binds beyond `127.0.0.1`. Today the token is optional; that default cannot
  survive contact with a public URL.
- **Version negotiation.** The dispatch path checks `/health` protocol (or the broker
  checks it at connect) and refuses mismatched majors with an actionable "update your
  runner" error. The affordance exists; nothing consumes it yet.
- **Offline behavior.** A dispatch to an absent runner fails fast with a clear message
  and, where configured, falls back to the cloud runner. Never a hang.
- **Conformance stance.** Per the sidecar-deployment proposal §5, v1 supports exactly
  one external runner: ours. "Any protocol-compatible third-party runner" waits for
  the versioned protocol, schemas, and conformance suite.
