# Plans at three levels of complexity

Each tier is independently shippable and each one carries forward into the next. Tier 0
proves demand, Tier 1 makes it a product, Tier 2 makes it native. Effort labels are
rough shape, not commitments.

## Tier 0: glue what exists (days, flag-gated, design partners only)

Goal: one design partner runs a real playground turn on their own laptop, with traces,
tools, and approvals working, before we build anything permanent.

What we build:

1. **Per-project runner URL.** Today the runner URL is one deployment-wide env var
   (`AGENTA_RUNNER_INTERNAL_URL`). Add a per-project (or per-environment) override the
   agent service consults at dispatch, stored as a simple project setting, behind a
   dev flag. This is the only backend change in the tier.
2. **Forward the runner token per project.** The dispatch client already sends
   `AGENTA_RUNNER_TOKEN` when set; read it from the same project setting so each
   external runner has its own secret.
3. **A setup recipe, not a product.** Documented steps: clone or `pnpm install` the
   runner, set `AGENTA_RUNNER_HOST=0.0.0.0` and `AGENTA_RUNNER_TOKEN=<random>`, run
   `ngrok http 8765`, paste the ngrok URL and token into the project setting.
4. **Two hard safety rules,** small code changes: the runner refuses `/run` without a
   token when bound beyond loopback, and the dispatch path refuses to send managed
   vault secrets to an external runner URL unless the project explicitly opts in
   (default the partner to self-managed model auth).

What we deliberately skip: packaging, registration APIs, UI, key scoping, version
checks. The user is technical and hand-held.

Exit criteria: a full turn (streamed, traced, gateway tool called, approval answered)
executes on a machine outside our network. We learn where latency and connection drops
actually hurt before designing around them.

## Tier 1: productized pairing (weeks)

Goal: a non-expert user connects their machine in under five minutes with one command,
and Agenta shows the runner as a first-class run target. Still tunnel-based.

Work packages, in dependency order:

1. **Runner registration API.** `POST /runners` (register: url, token, protocol
   version, machine label), `GET /runners` (list with last-seen), `DELETE /runners/:id`
   (revoke). A registration row binds runner, project, and pairing token. Heartbeat
   updates last-seen; the dispatch router treats a stale heartbeat as offline.
2. **The runner key.** Add a scope column to `APIKeyDB` and a middleware check. Scope
   `runner` grants: OTLP ingest, `/tools/call` and direct platform ops, the sessions
   plane, `/access/permissions/check`, and the `/runners` heartbeat. Nothing else.
   Created and revoked together with the registration. Surface expiry while we are in
   this code, since the column already exists.
3. **`@agenta/runner` CLI.** Published npm package wrapping the existing runner:
   `npx @agenta/runner connect` prompts for the runner key, generates the pairing
   token, starts the server, opens the bundled tunnel (cloudflared quick tunnel or
   ngrok), registers, and prints "waiting for runs." `--docker` prints the equivalent
   `docker run` line for the image the sidecar-deployment work publishes.
4. **Routing and dispatch changes.** The agent service resolves a run's target: an
   explicitly selected registered runner for this project, else the cloud runner.
   Consume the `/health` protocol version at registration and dispatch; refuse
   mismatched majors with "update your runner." Fail fast with "your runner is
   offline" and offer cloud fallback.
5. **UI.** A "Runners" section in project settings (connected machines, last seen,
   revoke) and a runner picker in the playground next to the existing
   environment/sandbox choices.
6. **Docs.** A how-to for the CLI path and one for the Docker path, plus an honest
   security page: what the agent can do on your machine, what secrets do and do not
   leave the cloud, and why self-managed model auth is the default.

Explicit dependencies on neighbouring projects: the published runner image
(sidecar-deployment Phase 4) for the Docker path, and coordination with
session-keepalive on TTL behavior when the runner disappears mid-park (already
fail-closed; just verify the interaction rows surface correctly in the UI when the
warm tier is lost).

## Tier 2: the native runner (months)

Goal: delete the tunnel. The runner is a signed single binary that dials out, holds a
persistent authenticated connection, and needs no public endpoint, no second tool, and
no inbound port. GitHub-Actions-runner ergonomics.

Work packages:

1. **Runner broker.** A cloud component that terminates runner WebSocket (or SSE plus
   POST) connections, authenticates the runner key, tracks presence, and correlates
   dispatches with response streams. The agent service hands dispatches to the broker
   instead of dialing a URL; the `/run` payload and NDJSON event semantics are carried
   unchanged inside the channel, so the wire contract, golden fixtures, and both
   engines stay untouched.
2. **Runner-side channel client.** The runner gains a `connect` mode that maintains the
   outbound connection with backoff and resume, and executes dispatches through the
   exact code path `POST /run` uses today (the HTTP server remains for local and
   compose deployments).
3. **Single-binary build.** Bun or pkg compilation, signed macOS/Linux/Windows
   artifacts, an install one-liner, and self-update with the protocol-version handshake
   from Tier 1 enforcing skew.
4. **Durable sessions for flaky machines.** Adopt harness-session-resume slice B for
   user runners: transcript copy into the object-store mount and the harness session id
   on a backend sessions row, so a laptop reboot resumes with full harness memory
   instead of cold replay. (Slice A already works incidentally: the user's disk
   persists.)
5. **Credential collapse and hardening.** Remove the pairing token (the broker channel
   replaces it), keep per-run `Secret` tokens inside payloads, and pick up the deferred
   sidecar-trust items that still matter in this topology (short-lived scoped tokens
   for callbacks, payload encryption if we ever route through third-party
   infrastructure).
6. **Conformance suite** (from sidecar-deployment §5): versioned protocol identifier,
   published JSON schemas, and a runnable conformance test. This is what would ever
   allow a third-party runner implementation; until it exists, "bring your own runner"
   means "run ours anywhere."

## What to decide before Tier 1 starts

1. **Tunnel vendor for the bundled v1**: cloudflared quick tunnels (free, no account,
   URL per session) vs ngrok (account required, stable URLs on paid) vs a minimal
   Agenta-operated relay (most work, most control). The registration API absorbs any
   of them, so this is swappable, but the CLI UX depends on it.
2. **Managed secrets to user runners: allowed at all?** The conservative call is to
   ship Tiers 0 and 1 as self-managed-only and revisit once the secret-isolation
   project's short-lived provider tokens exist. That also keeps the security page
   simple: "your keys stay on your machine, our keys stay in the cloud."
3. **Fallback semantics**: when a selected user runner is offline, fail the run or
   silently fall back to the cloud runner? (Recommendation: fail with a one-click
   "run in cloud instead," because silent fallback surprises the user in the
   opposite direction, running on our infra when they chose theirs.)
