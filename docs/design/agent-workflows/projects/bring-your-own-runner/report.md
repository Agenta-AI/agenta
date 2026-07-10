# Report: bring your own runner

The user story: someone uses Agenta Cloud, but the agent executes on their own machine.
In the extreme case the runner is one executable they download and start. This report
answers the five questions. The evidence behind every claim is in
[research.md](research.md); the solution space is in [architectures.md](architectures.md);
the phased plans are in [plans.md](plans.md).

A mental model to hold while reading: the runner is a **worker**, and Agenta Cloud is
the **control plane**. The cloud decides what to run (config, secrets, tools, history)
and pushes it all into one `POST /run` call. The runner executes and, while executing,
calls back into the cloud for four things: tool execution, session bookkeeping, token
refresh, and trace ingest. Nothing else crosses the wire.

## 1. Which interfaces does the runner need?

Two directions, and they have very different difficulty.

### Inbound (the hard direction): the cloud dispatches the turn

The backend calls `POST /run` on the runner and streams NDJSON back over that same
connection. This one call carries the entire turn: the agent config, the conversation
history, the resolved model and provider, the resolved tools, the permission policy,
the trace context, and (on managed runs) the provider secrets. There is no separate
"fetch your config" or "fetch the version" interface. Versioning is a non-interface for
the runner: the service resolves the revision and pushes the result. The runner also
serves `GET /health` (identity and protocol version) and `POST /kill` (teardown).

This is the direction that breaks on a user machine. A laptop behind NAT has no
reachable address, which is exactly why the v0 story needs a reverse proxy like ngrok,
and why the long-term story should flip the direction (see question 5).

### Outbound (the easy direction): the runner calls back to the cloud

Four endpoint families, all plain HTTPS that any home network allows:

- **Tool gateway** (`POST /tools/call`, plus direct platform ops like
  `/tools/discover`). This is how gateway and platform tools execute without their
  secrets ever reaching the user's machine. Composio keys and connection auth stay in
  the cloud; the runner sends the call, the cloud executes it. Optional in the sense
  that a run with no gateway tools never touches it, but it should ship from day one
  because it is what makes tools safe on an untrusted machine.
- **Session coordination** (`/sessions/states`, `/sessions/streams/*`,
  `/sessions/interactions/*`, `/sessions/mounts/sign`, `/sessions/contract`). Session
  rows, stream liveness, approval interactions, and durable-mount signing all live in
  the cloud DB. This is also where the post-JP session work lands: for
  harness-session-resume (option 3), the durable variant persists the harness session
  id on a backend sessions row and copies transcripts into the object-store mount, both
  through this plane. The local MVP variant needs nothing new: the harness session file
  sits on the user's own disk, and a personal machine keeps its disk, so a user-hosted
  runner actually gets resume *more* naturally than our cloud runner does.
- **Credential refresh** (`GET /access/permissions/check`). The per-run token expires
  in about 15 minutes; long sessions re-mint it here.
- **Trace ingest** (`POST /otlp/v1/traces`). The runner exports the full span tree
  (turns, model calls, tool calls, usage, cost) nested under the caller's trace. This
  is what keeps observability intact even though execution left our infrastructure.

One detail worth appreciating: the runner holds no standing credential today. All four
outbound surfaces authenticate with one short-lived token that arrives inside the
`/run` payload. That design travels to a remote runner unchanged.

## 2. What does our runner add on top of sandbox-agent?

`sandbox-agent` is a thin runtime: it manages the harness process, speaks ACP to it,
and offers a local or Daytona sandbox. Everything that makes an agent run an *Agenta*
run is our layer:

1. **The `/run` contract itself**: the wire protocol, the neutral event model, the
   NDJSON streaming framing, golden-fixture-pinned on both sides.
2. **Tracing**: a bundled Pi extension (and an ACP-derived equivalent for Claude) that
   builds the Agenta span tree with real token usage and exports it OTLP into the
   caller's trace. sandbox-agent has zero tracing.
3. **Approvals and permissions**: the allow/ask/deny policy engine, the ACP permission
   responder, and parked gates that hold a live session so an approved tool resumes
   with byte-exact arguments.
4. **Tool delivery**: native tool registration for Pi, a loopback MCP server for
   Claude, and a single dispatcher that keeps every tool's private half (call refs,
   auth, scoped secrets) in runner memory. The sandbox only ever sees public metadata.
5. **Secret hygiene**: clear-then-apply provider env, no env inheritance, read-once
   OTLP bearer files. This layer is precisely what makes a user-machine runner safe to
   contemplate.
6. **Sessions**: the keep-alive pool, the durable cwd mount, cold-replay transcripts,
   and the upcoming session/load resume.
7. **Operational skin**: health and capability probes, error recovery (the
   swallowed-Pi-error fix), crash-proof serving, Daytona auto-stop, licensing
   enforcement (Pi baked, Claude Code installed at runtime from Anthropic, never
   redistributed).

The takeaway for this project: shipping "the runner" to users means shipping all of
that, which is fine, because it is one self-contained Node package. What we must not do
is tell users "just run sandbox-agent," because sandbox-agent alone gives them no
tracing, no approvals, no tool safety, and no Agenta wire contract.

## 3. What are the limitations of running on the user's machine?

Grouped by how much they hurt.

### Reachability and transport (the v0 blockers)

- The backend initiates the dispatch, so the runner must be reachable. ngrok works but
  adds setup friction, a per-user URL that changes on restart (free tier), and a
  public HTTPS endpoint where none existed.
- The `/run` hop was designed for a trusted private network: plain HTTP, optional
  static token, and **plaintext provider secrets plus reusable bearer tokens in the
  body**. Publishing that through a tunnel without hardening hands vault keys to
  anyone who learns the URL. TLS comes free with ngrok, but authentication does not:
  the pairing token must become mandatory for any non-loopback runner.
- Streaming and approvals hold connections open for minutes. Tunnels and home routers
  drop idle connections; we need heartbeats or reconnect logic on the dispatch path.

### Fidelity degradations (annoying, not blocking)

- **Approval parking and keep-alive assume the runner stays up.** A laptop sleeps, wifi
  drops, the process restarts. The system already degrades safely (cold replay, never
  failure), but users on their own machines will hit the degraded tier more often:
  approvals answered after an outage re-run cold, with the known cold-replay fidelity
  loss, until harness-session-resume lands.
- **Latency.** Every gateway tool call and every session heartbeat is now a round trip
  over the public internet instead of a container network. Tool-heavy turns get
  noticeably slower.
- **Version skew.** We update the cloud weekly; users update their runner never. The
  `/health` endpoint already advertises a protocol version, but nothing reads it today.
  A user-runner fleet makes the skew guard mandatory: refuse the dispatch, tell the
  user to update.

### Structural limits (accept and document)

- **No sandbox isolation.** On the local provider the harness runs directly on the
  user's machine with the user's filesystem. That is the feature (the agent works on
  their real code), but it also means our network-policy and sandbox-permission
  enforcement do not apply. The product must present this honestly: on your machine,
  the agent has your permissions.
- **Secrets flow outward on managed runs.** If the run uses vault-stored provider keys,
  those keys land on the user's machine. Defensible when the runner belongs to the same
  project that owns the keys, but it argues for preferring self-managed auth (the
  user's own API key or subscription login) on user-hosted runners.
- **Licensing.** We can bake Pi (MIT) into anything we distribute. We can never bake
  Claude Code; the runner installs it from Anthropic at first use, so first-run needs
  internet and adds a delay.
- **Uptime is the user's problem.** Scheduled or triggered runs that route to an
  offline runner must fail with a clear "your runner is offline" rather than hang.

## 4. Do we need a new API key type?

Short answer: **no for a v0 behind a flag, yes before this is a real feature.** And the
architecture choice changes how much key work is needed.

What exists today:

- A **project-scoped ApiKey** functionally works right now. The runner's entire
  outbound surface (traces, tools, sessions) already authenticates with exactly this
  shape of credential. A user could hand their runner a project API key and everything
  would flow.
- But an ApiKey carries the **full RBAC of the user who created it**. A runner
  credential can read and delete testsets, evaluations, secrets, everything in the
  project. There is no scoping mechanism at all on `APIKeyDB`, and key expiry exists as
  a column but is not exposed.
- In the other direction, backend-to-runner auth is a single global static token,
  which cannot work multi-tenant.

What a real runner credential needs (call it a **runner key**):

1. **Capability-scoped**: valid only for trace ingest, the tool gateway, and the
   sessions plane. Implementation-wise this is a scope column on `APIKeyDB` plus an
   enforcement check in the auth middleware, not a new auth system.
2. **Bound to one runner registration**: created when the user connects a runner,
   revoked when they disconnect it, visible in the UI as "this machine, last seen 2
   minutes ago."
3. **Project-bound**: the routing rule "only send this project's runs to this runner"
   falls out of the same registration row.

Note what the dial-out architecture does to this question: if the runner connects
outbound and dispatch rides the connection the runner opened, the backend-to-runner
credential disappears entirely. One runner key covers registration, the dispatch
channel, and all callbacks. That is one credential for the user to copy, which is also
the simplest thing to explain.

## 5. A simple proposal

Design goals: one command to set up, small memory footprint, and a hard guarantee that
only the owning Agenta project can use the runner.

### The shape

```
User's machine                          Agenta Cloud
+---------------------------+           +---------------------------+
| agenta-runner             |  pairs    | POST /runners (register)  |
|  - /run server on :8765   +---------->| stores: project, token,   |
|  - tunnel (v0) or         |           |         url, version      |
|    dial-out (v1)          |           |                           |
|  - spawns Pi / Claude     |<----------+ dispatch /run (this       |
|    on the host            |  turns    |   project only)           |
|                           +---------->| /tools/call, /sessions/*, |
|                           | callbacks |   /otlp/v1/traces         |
+---------------------------+           +---------------------------+
```

Setup the user sees:

```
$ npx @agenta/runner connect
  Paste your runner key: ak_...
  Connected to Agenta Cloud as project "acme-support-bot".
  Waiting for runs.
```

Under the hood, `connect` starts the existing runner server, obtains a public URL
(bundled tunnel in v0; a held outbound connection in v1), and registers
`{url, runner_token, protocol_version}` with the backend under the runner key's
project. The playground then shows "your runner" as a target next to "cloud." Every
dispatch to it must present the pairing token; the runner rejects anything else. Only
runs from that one project ever route there, which, together with the token, is the
"only them can use it" guarantee.

For model auth, default user-hosted runners to **self-managed**: the user's own
provider key in their local env, or their Claude/ChatGPT login via the existing
subscription path. Then no vault secret ever leaves the cloud, which removes the
scariest part of the topology. Managed vault keys can remain an explicit opt-in.

### Without Docker (the default)

Ship the runner as a Node CLI (`npx @agenta/runner`), later as a single compiled
binary (Bun or pkg). The runner package already runs standalone via `tsx` today, so
v0 is packaging work, not architecture work. Footprint is a single idle Node process,
roughly 100 to 200 MB, with harness processes spawned only during a run. No daemon
manager, no image pulls. This is the right default because the whole point of the
story is the agent touching the user's real machine: their repos, their files, their
logins.

### With Docker (the isolation option)

`docker run ghcr.io/agenta-ai/agenta-runner -e AGENTA_RUNNER_KEY=ak_...`, reusing the
image the sidecar-deployment proposal already plans to publish. Docker buys isolation
from the host (the agent sees a container filesystem, not the user's home directory),
pinned dependencies, and clean teardown. It costs the two things this user story is
about: access to the user's actual files, and lightness (image pull, a resident
container, Docker itself as a prerequisite). Offer it for the cautious user and for
servers; do not make it the headline path.

### Why this stays simple

- Zero new wire contracts. The existing `/run` contract, callbacks, and OTLP path are
  used unmodified; v0 adds only a registration endpoint and a routing rule.
- One credential. The runner key covers pairing and all callbacks.
- Degradation is already designed. Runner offline means the run fails loudly or falls
  back to the cloud runner; warm-session misses already fall back to cold replay.

The three plans in [plans.md](plans.md) stage this: Tier 0 wires the existing pieces
manually (ngrok plus a per-project runner URL setting) to validate demand in days;
Tier 1 builds the pairing flow, the runner key, and the packaged CLI; Tier 2 replaces
the tunnel with a native dial-out connection, the way GitHub Actions self-hosted
runners and Buildkite agents work, which deletes the public endpoint entirely.
