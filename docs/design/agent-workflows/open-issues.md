# Open issues

Deferred TODOs and open questions for the agent-workflows project. Each entry carries enough
context and provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### Supply secret values to tools during a standalone run

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** sdk-local-tools design review session (answering reviewer comments on plan.md, Decision 3)

**The problem.** An agent's `code` tool declares the secrets it needs by name, for example
`secrets: ["GITHUB_TOKEN"]`. An MCP server declares an env-var-to-name map. The config stores
only the name, never the value. At run time something must turn the name into a value and
inject it as an env var, into the sandbox subprocess for a code tool or into the server
process for MCP. On the Agenta server path that consumer is meant to read the `custom_secret`
entries from the project vault by name, but it is not built yet. Custom secrets are
storage-only this iteration by design, so today a declared secret resolves to nothing and the
tool runs without it. For a standalone run the goal is different: do not depend on the Agenta
vault at all. The trouble is the SDK has no secret resolution of any kind today. Resolution
lives only in the service. So a standalone agent has no way to supply `GITHUB_TOKEN` to its
code tool.

**Why it is deferred.** The first slice is offline and narrow (built-in plus code tools with
env secrets). Env alone closes the gap for that slice, so the wider question of where secret
values come from does not block it. The vault path also depends on work another effort owns
(see below), so it cannot land here yet.

**What to decide or do.** Pick the local source of secret values for a standalone run. Three
options, and they are not exclusive.

1. Env, the offline default. Read the declared name straight from the process environment.
   `GITHUB_TOKEN` comes from `os.environ`. Simple, offline, and enough for the first slice.
2. A pluggable `SecretResolver` interface. The user implements it. Env is the built-in
   default, but they can back it with a `.env` file, a secret manager, or their own vault. A
   small interface for a lot of flexibility.
3. The Agenta vault over HTTP. It reads `custom_secret` entries by name. This needs the
   future runtime consumer endpoint to be built, and it is the connected-standalone path
   only.

The lean: ship option 1 as the default and option 2 as the interface it plugs into, both in
the first slice. Treat option 3 as later work tied to the named-secrets effort building the
consumer. See [./sdk-local-tools/plan.md](./sdk-local-tools/plan.md) (Decision 3 and Phase
4), [./sdk-local-tools/research.md](./sdk-local-tools/research.md) (stage 3), and
[../vault-named-secrets/](../vault-named-secrets/).

### Batch the two vault round-trips on the agent invoke path

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** xhigh code review of the sdk-local-tools first slice

**The problem.** The service resolves a code tool's named secrets inside `resolve_tools` and an
MCP server's named secrets inside `resolve_mcp_servers`. Each one builds its own
`_VaultSecretResolver` and makes its own `POST /secrets/resolve`. When a config has both a code
tool and an enabled MCP server that each declare secrets, a cold invoke makes two sequential
vault round-trips where one batched call over the union of names would do. The two functions
are also awaited one after another in `app.py`, not concurrently.

**Why it is deferred.** MCP is flag-gated off this release, so the second round-trip does not
happen on the default path yet. The cost only appears once MCP turns on. Fixing it now would be
optimizing a path no one runs.

**What to decide or do.** When MCP comes off the flag (sdk-local-tools Phase 5), resolve the
union of code-tool and MCP secret names in one vault call, and consider running the independent
resolve steps in `app.py` concurrently.

### Give the resolved-tool shape one source of truth

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** xhigh code review of the sdk-local-tools first slice

**The problem.** `ResolvedTools` (the SDK resolver's return type) carries the same four fields,
`builtin_tools` / `custom_tools` / `tool_callback` / `mcp_servers`, that `SessionConfig` already
declares. The two shapes can drift: when a new per-tool wire field lands, a maintainer has to
add it in both places, and missing one silently drops the field from either the standalone path
or the service path.

**Why it is deferred.** The duplication is small and the two types serve different layers today
(a resolver result versus the full session bundle). It is a maintainability touch-point, not a
bug.

**What to decide or do.** Decide whether the resolver should return the `SessionConfig` tool
fields directly (or a shared sub-model both reuse), so the wire tool shape has one definition.
