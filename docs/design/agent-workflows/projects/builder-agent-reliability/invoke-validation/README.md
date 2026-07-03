# Invoke validation

Implemented. Validation lands at the SDK resolver boundary (see `status.md`).

The agent service invoke endpoint (`POST {host}/services/agent/v0/invoke`) did not tell a
caller when the request was malformed. Send `references` with no revision, or send
`data.revision` one level too shallow, and the service silently ran a seeded default
(`pi_core` / `gpt-5.5`) and then 500'd. The caller got an opaque late error instead of "your
request was shaped wrong, here is the right shape."

This project reframes that as a validation problem. The boundary validates the request up front
and, when it cannot resolve to a config, returns a clear 400 that names the two valid ways to
invoke an application:

1. Provide configuration inline (`data.parameters`).
2. Provide a revision: either a complete revision nested correctly (`data.revision = {"data":
   ...}`), or a resolvable reference that pins one committed config (a variant, an environment, or
   a revision, not a bare application).

## Files

- `context.md` — the symptom (malformed invoke -> silent default -> late 500), why it cost the
  lab time, and why validation (not self-hydration) is the right lens. Goals and non-goals.
- `research.md` — the mechanism with `file:line` citations: the resolver requires a double-nested
  revision (`resolver.py:150`), the agent's seeded default disables reference hydration
  (`utils.py:285-287`, gate at `resolver.py:573-577`), the envelope ignores unknown fields
  (`workflows.py:237`, `:296`), the product path pre-hydrates the reference so it works
  (`service.py:745-751`), the reference-family validator that already raises 4xx
  (`resolver.py:69-98`), the three reference-kind results, and the live reproduction.
- `plan.md` — the shipped validation: Rules A (revision nested right) and B (reference must be
  resolvable, not a bare application), raised as a clear 400 at the shared resolver boundary,
  consistent across agent / completion / chat. Scope limits (no blanket forbid, no OpenAPI, no
  "nothing to run" rule so completion / chat do not regress) and the test matrix.
- `status.md` — implemented; decisions locked and open questions resolved.

## Status

Implemented at the SDK resolver boundary (`_validate_resolvable_config`). Supersedes and merges
the earlier `harden-invoke` decision and the `silent-fallback` / `invoke-contract` threads under
`docs/design/agent-workflows/scratch/console/builder-kit/`. See `status.md`.
