# Agent permission defaults

New agents should run ordinary work without approval. The playground build kit should
set explicit approval policies for its platform operations. Settings should expose a
general permission dropdown without harness or sandbox implementation details.

## Reading order

- [Context](context.md): goals, scope, and agreed behavior.
- [Plan](plan.md): implementation slices and acceptance checks.
- [Research](research.md): current code and policy ownership.
- [Spikes](spikes.md): Claude and Codex questions and evidence requirements.
- [Claude findings](claude-spike.md) and [Codex findings](codex-spike.md): executed
  tests, native settings observations, and blocked live checks.
- [Validation](validation.md): implementation checks and desktop/mobile coverage.
- [Status](status.md): implementation and verification progress.

## Terms

A **harness** is the agent engine: Pi, Claude, or Codex. The **runner** executes that
engine and handles tool delivery and approval requests. An **execution environment**
is where it runs, such as local or Daytona. The **build kit** is a temporary set of
tools and guidance added to playground runs, not saved in the agent configuration.

Tool availability, approval policy, API access, and environment isolation are separate.
An explicit tool policy overrides the general permission fallback.
