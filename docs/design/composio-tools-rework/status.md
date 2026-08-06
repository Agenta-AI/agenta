# Status

Source of truth for progress and decisions. Newest decisions at the top of each
list.

## Stage

Planning. Producing design docs for a PR. No code changed.

## Decisions taken

- **Move from per-action config entries to per-connection, tools exposed over a
  Composio session (MCP).** Fixes #5173, #5174, and the hundred-entries problem
  by design. (2026-08-06)
- **The Composio key never enters the sandbox.** Proven necessary: the only
  credential that drives the session MCP endpoint is the project key, which
  reaches every tenant's connections. The Agenta API holds it and forwards.
  (2026-08-06)
- **One session per connection, reused forever.** Sessions do not expire
  (documented). No recreate-on-expiry logic needed. (2026-08-06)
- **Large results: write to a file in the sandbox mount, return the path.** Our
  own approach, provider-agnostic. We do not depend on Composio's workbench.
  (2026-08-06, Mahmoud)
- **Disable Composio's connection-manager meta-tool.** The frontend already lets
  the agent ask for a connection; we reuse that. (2026-08-06, Mahmoud)

## The main design choice (both go in the PR)

Two shapes for how the harness reaches the session, both in the PR with a
comparison:

- **Option 1, call the meta-tools over REST as our own callback tools
  (recommended).** Reuses the callback transport, cap, tracing, and permissions;
  works on Pi; keeps the key in the API.
- **Option 2, proxy the session as an MCP server.** Cleaner in theory, but does
  not work on Pi, needs a streaming proxy, and moves the trust boundary.

**Recommendation flipped to Option 1 after the Codex review.** The deciding fact:
the session's meta-tools are callable over plain REST (proven in the spikes), so
we do not need MCP at all, and the REST path reuses everything we have and runs
on Pi. Option 2 (the earlier lead) is documented as the alternative and the right
shape only if we later host user-provided MCP servers.

## Codex review outcome (2026-08-06)

Ran a staff-engineer architecture and soundness review through Codex at xhigh.
Accepted and folded in:

- Flip to Option 1 (REST meta-tools), because Composio exposes the meta-tools
  over REST and it reuses our machinery and works on Pi.
- Session keyed on the tool policy, not the connection, and immutable per policy.
  Fixes the cross-agent PATCH race. Removes in-place PATCH and warm-reuse-across-
  policy-change gymnastics.
- Session state lives in a dedicated `gateway_sessions` mapping table with a
  uniqueness constraint, not the connection `data` blob.
- Pin the connected account at session creation.
- Distinct config discriminator (`gateway_toolkit`), policy vocabulary
  (`all` / `include` + actions), actions are Agenta keys mapped to slugs
  server-side.
- Name the resolver seam change (one config yields several meta-tool specs).
- Handle a stale action in an explicit policy gracefully at session create.
- Restructure the plan into three vertical slices.

Pushed back on (judgment, pre-PMF):

- Codex wanted the session keyed per conversation too. Our meta-tool use is
  stateless and the workbench is off, so per-policy keying is enough. Noted as a
  refinement only if state leaks.
- Kept both options documented, per Mahmoud's request, rather than deleting
  Option 2.

## Open questions

- Does Shape A keep deny, interactive "ask", and tracing? (Investigation in
  progress.)
- Permission granularity: if the model only sees meta-tools, "ask before this
  one specific action" may need action-level enforcement at the API. Product
  call.
- Search relevance on our real use cases. Needs a hands-on check.
- Migration of existing per-action config entries. The compat layer already
  normalizes two shapes.

## Answered by research (see research.md section 3)

- Session TTL: sessions do not expire.
- Scoped credential: none that both drives MCP and stays confined.
- Piping tool calls in a script: Composio's workbench does it over MCP; harness
  native features do not help portably.

## Reviews planned

- Architecture and repo-conformance review (Codex, staff-engineer lens).
- Correctness and soundness review, with an explicit guard against over-scoping.
  Pre-product-market-fit: every unwarranted piece of complexity is a new thing
  to maintain and a new place for bugs.
