# C1 merge notes

Facts the merge needs that no single package could record on its own. Written as
each package lands, read in full before merging.

## The C0 seed had one real defect, and WP2 fixed it

`ChannelConversation.units` and `.default` were typed `ChannelSessionScope`
(`thread | message`) at C0. The declaration's vocabulary is
`thread | space` — `ChannelKeyGrain`. A platform with no threads degenerates to
the **space**, never to a per-message session.

It is a defect rather than a preference: `contract.md` §4's own worked
`bridge.hello` declares `"units": ["space"], "default": "space"`, which the C0
typing **rejected** with two validation errors. Every declaration in
`capabilities.md` §2, `contract.md` §4 and `specs-wp6.md` uses `"space"`.

Fixed on `channels-wp2` in `core/channels/dtos.py`, with the seed fixture in
`test_channels_seed.py` corrected to match `capabilities.md` §2 verbatim.
`ChannelSessionScope` remains correct and untouched on both policy documents —
the two enums are genuinely different vocabularies, which is what made the
confusion possible.

### It breaks WP1, which branched before the fix

`resolve_policy` in WP1's `core/channels/utils.py` compares a `session_scope`
against `capabilities.conversation.units` and calls
`SESSION_SCOPE_ORDER.index(unit)` over those members. Under the corrected
typing that raises `ValueError`: `ChannelKeyGrain.SPACE` is not in
`SESSION_SCOPE_ORDER`.

The two vocabularies have to be reconciled deliberately at the merge, not
papered over by widening a type:

- **`units` constrains what the platform can key**, so the capability ceiling
  applies to `THREAD` only. A declaration without `thread` means no thread
  scope is offerable, and the effective scope falls to `MESSAGE`.
- Map before comparing — do not add `SPACE` to `SESSION_SCOPE_ORDER`, and do
  not index a grain against a scope ordering.

WP1's own tests pass in its worktree because it holds the pre-fix seed. Rerun
them against the merged base before believing them.

## Collision-file edits, to apply serially

`api/entrypoints/routers.py` is owned by no package. WP3 wrote its intended
edit out verbatim in its report; apply that plus WP1's service/DAO wiring as
one edit at the merge.

WP3 **did** edit `oss/src/middlewares/auth.py` (`_PUBLIC_ENDPOINTS`), which is
its own per `README.md` — eight literal paths, four variants each for
`/channels/slack/events/` and `/channels/bridge/events/`. Verified: no
configuration route under `/channels/` is prefix-exempted by any of them.

## One open decision

`entities.md` §9 sketches ingress and configuration sharing a single
`ChannelsRouter`. WP3 shipped `ChannelsIngressRouter` alone, since WP8 does not
exist yet. Either WP8 folds WP3's two routes into its own router — matching the
document — or both mount separately under the same prefix. Both are safe for
`_PUBLIC_ENDPOINTS`, which is path-scoped rather than router-scoped. The
document's shape is the default unless WP8 finds a reason against it.

## Verify at the merge, do not assume

Each package's tests pass against **its own** worktree's base. The C1 exit
conditions in `launch.md` are the only ones that count, and they run on the
merged tree.

## What is deferred to the checkpoint deployment

Packages are verified by unit tests and static checks only — a worktree has no
environment, and one is not stood up per package. Everything below needs a
running stack and is therefore **written but unverified** until the deployment
that opens C1:

- A signed request to `POST /channels/slack/events/` writes exactly one
  `channel_inbox_events` row and answers 202.
- An unsigned request is rejected.
- A redelivery of the same event writes no second row.

Everything else at C1 — the contract suite failing a lying adapter, the
`_PUBLIC_ENDPOINTS` scoping, DTO and key-composition behaviour — is unit-level
and already holds without a deployment.

## C1 carries the result; the package worktrees are not rebased

The original runbook ended C1 with "every worktree rebases on the merged base".
Superseded: `channels-c1` already contains all three packages plus the three
cross-package fixes, so rebasing WP1/WP2/WP3 would only re-derive what C1 holds.
Their ledgers are closed *here*, and **wave 2 branches from `channels-c1`**, not
from a package branch.

This matters most for WP2, whose own branch lacks the `resolve_policy` fix that
its `units` correction made necessary — reading that branch in isolation would
show a defect C1 has already resolved.

## For wave 2: the seam is where the bugs are

All three C1 defects had the same shape — two packages, each internally
consistent, each green in its own worktree, disagreeing about a shared surface.
None was findable without running them together.

- A **vocabulary** clash: `units` is a grain set (`thread|space`), `session_scope`
  is a scope (`thread|message`). Both spell one member "thread", which is what
  made the confusion survive review.
- A **convention** clash: `Column(Enum(X))` persists the member *name*, so the
  migration's labels must be uppercase. Every other enum in the database already
  was; channels was the outlier.
- A **naming** clash: the caller and the callee spelled the same two operations
  differently, and fakes on both sides agreed with their own author.

The practical rule for a wave-2 package: **when you fake a collaborator, you are
asserting its interface — write down what you assumed.** WP3's fake service was
correct code built on a wrong assumption, and the assumption was invisible until
something real was on the other end. Put those assumptions in your final report
even when your tests pass, especially then.
