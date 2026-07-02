# Status

**State: implemented. Validation lands at the SDK resolver boundary.**

This workspace reframed the invoke silent-fallback problem as a request-validation problem and
now ships the validation. It supersedes and merges the earlier `harden-invoke` decision and the
`silent-fallback` / `invoke-contract` threads under
`docs/design/agent-workflows/scratch/console/builder-kit/`.

## What is decided

- The frame is validation, not self-hydration. A malformed invoke gets a clear 400 at the
  boundary, not a silent default and a late 500.
- **Two valid call shapes, not three.** There is no legitimate empty or default intent for an
  agent invoke. The caller either provides a config, or specifies a revision:
  1. **Inline configuration:** `data.parameters`.
  2. **A revision:** either a correctly double-nested `data.revision = {"data": {...}}`, or a
     resolvable reference that pins one committed config — a variant, an environment, or a
     revision (`latest` is fine; an environment selects the deployed revision).
- A bare `application` reference is not resolvable; the same holds for a bare `workflow` or
  `evaluator` root. A resolvable reference needs a variant, an environment, or a revision.
- **Status code: 400 (`bad_request`).** Matches `_validate_executable_reference_families`, which
  already raises 400 for competing reference families at the same boundary. Stay consistent.
- **Where it lives: the SDK resolver boundary only.** A sibling validator,
  `_validate_resolvable_config`, sits next to `_validate_executable_reference_families` in
  `sdks/python/agenta/sdk/middlewares/running/resolver.py` and is called at the top of
  `ResolverMiddleware.__call__`. The revision-nesting check lives in the resolver (Rule A), not in
  `models/workflows.py`, so the error can carry the same shapes message.
- **Scope to the config path, not the whole envelope.** No blanket `extra="forbid"`. The
  validator only rejects an expressed-but-unresolvable config intent (a wrong revision nesting, or
  a reference that pins nothing). Extra metadata fields are still accepted. No OpenAPI; `/inspect`
  stays the live contract.
- **The self-hydration fix stays separate.** Dropping the agent's seeded parameters at
  `utils.py:285-287` (so a references-only agent call self-hydrates like completion and chat) is a
  complementary follow-up and is NOT bundled here. This change is validation-only.

## How the open questions resolved

1. **400 vs 422.** 400 (`bad_request`), to match the existing family validator at the same
   boundary.
2. **Rule C over-rejection on completion/chat.** Dropped as its own rule. The validator never
   rejects an empty body: an empty request expresses no config intent, and config can still arrive
   from the running context or a pre-installed handler. It rejects only an EXPRESSED but
   unresolvable intent — a present-but-single-nested `data.revision` (Rule A) or references that
   pin nothing (Rule B). So completion and chat do not regress, and there is no "run the default"
   carve-out to reason about.
3. **Where the check lives.** A sibling validator (not folded into the family check), at the
   resolver boundary. Simpler to read and keeps the family check focused.
4. **Revision-nesting check placement.** In the resolver (Rule A), so the error references the
   same two-shapes message. Not in `models/workflows.py`.
5. **Bundle with self-hydration?** No. Validation-only. The seed fix is tracked separately.

## What shipped

- `sdks/python/agenta/sdk/middlewares/running/resolver.py`: `_validate_resolvable_config` (Rules A
  and B) plus the `_RESOLVABLE_REFERENCE_KEYS` / `_INVOKE_CALL_SHAPES` helpers, called from
  `ResolverMiddleware.__call__`.
- `sdks/python/oss/tests/pytest/utils/test_resolver_middleware.py`: `TestResolverConfigValidation`
  covering inline config, a double-nested revision, a resolvable reference (variant / environment /
  revision), a bare `application` reject, a bare `workflow` reject, a single-nested `data.revision`
  reject, an empty-request pass, and a bare-application reject through the middleware.

## Next steps

- Complementary follow-up: drop the agent's seeded default parameters (`utils.py:285-287` ->
  empty `WorkflowRevisionData()`) so a references-only agent call self-hydrates like completion and
  chat. Tracked separately.
- Capture a live pass as a replay test once the change is deployed (see the `agent-replay-test`
  skill).
- The lab kit already documents inline and the double-nested revision as the correct shapes; keep
  it in sync if the messages change.
