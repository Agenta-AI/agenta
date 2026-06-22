# Status

Source of truth for where this work stands. Update this file as the work moves.

## State

**Phase: design converged, awaiting go for PR 1.** No code changed. The design passed two
Codex reviews: an architecture/naming pass and a CTO pass at xhigh effort. The current
direction lives in [design.md](design.md) (formal) and [explainer.md](explainer.md)
(plain-language). The first-draft vocabulary (`ModelRef`, `Connection`, `InjectionPlan`,
`ConnectionResolver`) is superseded.

Last updated: 2026-06-20.

## Converged vocabulary

| First draft | Now |
| --- | --- |
| `ModelRef` (carried a connection) | `ModelSpec { provider, model, params }` |
| `Connection` | `ProviderAccount` (user term: "provider account") |
| connection ref inside the agent config | `ModelAccessBinding` on the run, not the revision |
| `InjectionPlan` | `ResolvedModelAccess` |
| `ConnectionResolver` | `ModelAccessResolver` |
| `SidecarAuth` | self-managed, `source: runtime` (user term: "self-managed credentials") |

## Decisions taken

- **The mapping is its own port (`ModelAccessResolver`),** not the agent config and not the
  harness adapter. Adapters: vault (service), env (standalone), static (BYO).
- **Model intent is portable and committed; the account choice is not.** `ModelSpec` lives in
  the agent config. The concrete account binds on the run (invoke request override or
  environment default), never on `WorkflowRevisionData`. This resolves the placement question:
  the account choice leaves the agent config, as the user wanted, but lands on the run instead
  of the versioned revision, so export and cross-project reuse stay safe.
- **`ProviderAccount` is a read/resolve view over the existing vault for v1,** not a new
  storage model. One write path (the existing `/secrets`). This avoids a vault rewrite.
- **Least-privilege resolution.** One model, one provider, one account, one injected
  credential. Replaces the whole-vault dump.
- **Self-managed (`source: runtime`) covers OAuth subscriptions.** Agenta injects nothing; the
  harness uses its own rotating login. Managed OAuth is deferred.
- **Prompts and completions stay on their existing path, untouched.** The new surface is
  additive; the vault storage and `/secrets` API do not change.
- **Resolver is the future shared core, but we do not extend `SecretsManager` to get there.**
  v1 serves agents only; completions migrate later.
- **The duplicate-key behavior is handled explicitly,** not by guessing a default
  (see [design.md](design.md), "The duplicate-key landmine").

## Open decisions (small, need a quick call before or during PR 3)

- **Where the environment default account lives.** Environment config vs deployment config vs a
  small new per-environment record. Affects PR 3 only; the request-override path is unaffected.
- **User-facing term.** "Provider account" is the working choice. Keep "Provider key / Custom
  provider" as legacy settings labels during the transition, or rename in the same pass.
- **Whether the committed config may declare `self_managed`** as portable intent, or whether
  self-managed is always a run-time choice. Lean: allow `self_managed` as portable intent,
  since it names no project-local id.

## Risks and pre-existing issues flagged

- Duplicate keys for one provider behave differently across the two existing paths today
  (agent: first wins; completion: last wins). v1 resolve must force a choice, not inherit
  ordering. (`services/oss/src/agent/secrets.py:71`,
  `sdks/python/agenta/sdk/managers/secrets.py:219`)
- `AGENTA_CRYPT_KEY` defaults to `"replace-me"` (`api/oss/src/utils/env.py:410`). Out of scope;
  flagged for a security follow-up.
- Inherited provider env on the runner must be cleared before applying the resolved plan
  (`services/agent/src/engines/sandbox_agent.ts:309`, `:530`).
- The provider->env map in `services/oss/src/agent/secrets.py:26-35` is incomplete and partly
  dead. It is deleted in PR 2; do not extend it.
- The Codex harness does not exist in the runtime yet (only Pi and Claude). The Codex column in
  the translation table is design-ready but untested; PR 4 stubs it.

## CTO review summary (Codex, xhigh)

Verdict: ship with cuts. Biggest concern: do not put a concrete account binding on
`WorkflowRevisionData` (committed, exported, shared). Cuts adopted: read-view accounts instead
of CRUD, no storage migration in v1, binding on the run, no managed OAuth or completion
migration. Security non-negotiables and the deferred/missing list are folded into
[design.md](design.md).

## Next steps

1. Sign off [design.md](design.md) and [plan.md](plan.md).
2. Open PR 1 (neutral types and resolver port) per [plan.md](plan.md).
3. Record decision changes here and in [../open-issues.md](../open-issues.md) where they touch
   the broader agent-workflows stack.
