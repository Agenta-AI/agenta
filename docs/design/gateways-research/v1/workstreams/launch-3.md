# Wave 3 launch — to C3

Wave 1 built the gateways. Wave 2 made them the only way out. Wave 3 makes the things behind
them connectable: OAuth, and the two halves of "the agent cannot reach this, ask the user".

**C3 is "a user can connect anything, and an agent can ask them to."** An OAuth-protected MCP
server can be connected from the dashboard; a scope challenge raises an interaction instead of
failing; a refusal reaches the agent as a cause it can act on; and an agent that lacks a
connection can request one the same way it already requests an integration.

---

## What wave 2 left standing

Read these before planning a package. All four are new since `plan.md`'s wave-3 outline.

- **A gateway target must be registered before an agent can use it (D35).** The SDK no longer
  honours a URL and a secret declared in agent code; it routes by name and the gateway resolves
  the rest. The CRUD registries on both planes are not administrative convenience — they are the
  only place a secret can live once a sandbox cannot hold one. Wave 3 exists largely to make that
  registration reachable for OAuth-protected targets.
- **`builtin` is Composio-backed on the MCP plane (OD13, closed).** No curated direct-server set
  ships. This sets WP17's scope: Composio brokers the authorization for `builtin`, so **our own
  OAuth client is for `custom` endpoints** — the servers a user brings by URL. Two suppliers, two
  namespaces, and the client is not a fallback for the Composio path.
- **The relay never converts a body (D34), and the providers that clears are known (OD16,
  closed).** Anthropic, Gemini, Cohere, DeepInfra, Perplexity, MiniMax, Azure, Bedrock and Vertex
  all clear. SageMaker and two legacy per-vendor paths are recorded in `out-of-scope.md`.
- **Project-level secrets are the model (OD2, closed).** User-level secrets are out of scope.

---

## Before anything starts

Wave 3 needs no seed. Its serial spine changes shapes one package at a time, and the two
independent packages touch different files. What it does need is the base branch re-cut from the
current upstream release branch, as in both prior waves — re-read the branch name, it advances.

Wave 3 branches from **C3's predecessor**, `feat/gateways-c2` (`846e8fa15d`), which is IM4.

---

## The spine — OAuth, serial

Serial because each step needs the shape the one before it defines. Do not fan these out.

**WP16 — Secret kinds.** `oauth_provider` and `oauth_grant`: enum values, settings DTOs, union
arms, validator branches (D14). Coordinate with the parallel work adding kinds to the same enum.
*Depends on:* C2. *Blocks:* WP17.

**WP17 — OAuth client.** The official SDK's client provider, with a storage adapter over the
secrets service rather than its own store, and connect callbacks pointed at the dashboard rather
than a local browser. **Its target is the `custom` namespace** — a server the user brought by URL.
`builtin` is Composio-brokered and does not pass through this client.
*Depends on:* WP16. *Blocks:* WP18, WP19, WP20.

**WP18 — Consent flow.** Connecting an OAuth server from the dashboard, with scope selection.
*Depends on:* WP17.

**WP20 — Client registration fallback.** There is no callback-reachability work: the browser
reaches the redirect in every deployment, because it is the address the user is already on (D26).
What remains is registration. Prefer the client identity document; fall back to registering
outbound when the deployment's domain is not publicly resolvable, and make that fallback automatic
rather than a configuration flag.
*Depends on:* WP17.
*Done when:* a deployment on an internal-only domain completes a full authorization with no hosted
component of ours in the path.

**WP19 — Step-up interaction.** A scope challenge raises an interaction on the missing-connection
path.
*Depends on:* WP17, WP18, **WP25 and WP26**. The dependency on the last two is the change from
`plan.md`, and the reason is below.

---

## The two packages wave 2 surfaced

Both come from D35, and both serve the same story as WP19: *the agent cannot reach something and
needs the user to fix it.* WP19 rides the channel these two build. Building step-up on a channel
that loses the cause is finishing a road with a gap left in the middle — so these land first.

**WP25 — A refusal arrives as a cause, not a sentence.** The gateway already raises typed domain
errors for a missing credential, a rejected one, an unregistered target, a disallowed model and a
deactivated endpoint. What is unproven is that the cause survives the trip back: gateway to
harness to runner to agent service to caller.

Two known gaps, both found in wave 2 and both flagged rather than fixed:
- The runner recovers the cause by **parsing the harness's own error text** (`gateway-error.ts`,
  wired at `engine.ts`'s one choke point). Whether a given harness's SDK preserves the gateway's
  JSON body in that text is **unverified per harness** — WP13 said so explicitly.
- The agent service never surfaces `errorDetail` onto its own stream (`adapters/vercel/stream.py`),
  so even a correctly recovered cause stops before the caller.

The wire shape already exists: `AgentErrorDetail` is `{code, message, retryable, next_step?,
details?}` on `AgentRunResult`, matching the repo's agent-actionable error envelope. Do not invent
a second shape.
*Depends on:* C2. *Blocks:* WP19.
*Done when:* each of the five refusals above reaches the caller carrying its `code`, proven per
harness rather than assumed, and a harness that cannot preserve the body is recorded as such
instead of silently degrading.

**WP26 — An agent can request a gateway connection.** The affordance exists for external
integrations: the reserved `request_connection` client tool
(`core/workflows/static_catalog.py`), which takes `{integration, slug?, mode: oauth|api_key}` and
carries `render: {kind: "connect"}` so the client renders the connect dialog when the call pauses.
It does not cover a gateway endpoint on either plane.

Extend that tool rather than building a second one: the pause, the render hint and the resume path
are already built and tested. The new case is an agent naming a model or an MCP server it cannot
reach and asking the user to connect it — which is exactly what D35 made necessary by requiring
registration first.
*Depends on:* C2. *Blocks:* WP19.
*Done when:* an agent refused for a missing connection can raise a request that lands the user on
the right registration surface for that plane, and the run resumes on completion.

---

## The cleanups this wave carries

Six items from `cleanups.md` are unblocked by C2 and finish what wave 2 started. They are
independent of the spine and of each other unless noted, so they can run alongside.

| Item | What | Note |
| --- | --- | --- |
| **CU1** | Close the plaintext secrets read surface — the vault's read routes still return decrypted material to any caller with view permission | Ownership needs agreeing with the parallel bring-your-own-secrets work, not assuming |
| **CU2** | Remove module-level provider keys from the workflow handler — process-wide state that is a cross-tenant leak in a shared process | May be free: the handler is reported unused and may simply be deleted |
| **CU6** | Collapse the wire's per-server secret arrays to one gateway token | WP13 already verified they shrink; this finishes the wire's shape |
| **CU7** | Re-assess the runner's redaction deny-set now that it covers one short-lived token | Follows CU6; do not start it first |
| **CU10** | Remove the legacy credits counter, which counts access checks rather than usage | Independent |
| **CU12** | Collapse the four copies of the outbound SSRF guard into one per language | The gateway makes this guard the single control on every outbound call we make for a tenant |
| **CU13** | Turn the insecure-egress default off wherever a deployment is shared | **Do this first and separately.** One flag, set nowhere, currently disables all four guards |

The other cleanups stay a register: they are blocked on scope decisions (evaluators, the tool and
trigger domains) rather than on the gateways, and nothing here unblocks them.

---

## Merge

**IM5 → C3.** Deploy. The acceptance criteria above, plus wave 2's, still passing.

---

## Rules

The wave-1 and wave-2 rules hold unchanged — one package per worktree, plain `git`, no
cross-package edits, and no test ever calls a real LLM, a real MCP server or any live provider.
Three notes specific to this wave:

- **The spine is serial. Do not fan it out.** WP17 defines the shape WP18, WP19 and WP20 all
  consume, and three parallel guesses at it cost more than the wait.
- **A harness is a fact, not an assumption** — the rule OD14 produced in wave 2 applies again in
  WP25, where the question is what a harness does with an upstream's error body rather than with a
  header.
- **CU13 before CU12.** The posture fix does not need the duplication fixed, and bundling them lets
  the slower half hold the faster one.
