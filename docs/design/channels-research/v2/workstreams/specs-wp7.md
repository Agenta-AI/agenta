# WP7 — Identity links

This package delivers the mapping from a platform user to an Agenta account,
so that a turn the inbox worker (WP4) invokes runs with that user's
permissions and is attributed to them (D2). It also carries the refusal rule
(D17): one sentence naming the requested slug, never the reason, identical
whether the agent does not exist, is not in this connection's roster, or is
in the roster but not granted here. **WP7 writes no migration of its own** —
its tables are created by WP1's single migration, revision
`oss000000021`, alongside WP1's seven channels tables
(`workstreams/README.md` "Known collisions": *"One migration, owned by WP1,
containing WP7's tables too. The chain is linear... two packages both
claiming a revision id is a guaranteed conflict for no benefit."*). State this
explicitly in review: a PR for this package that adds a migration file is
wrong on sight.

## Files

Per `workstreams/README.md`'s ownership table:

- `api/oss/src/core/channels/identity.py` — **new**. The linking service:
  create/lookup a link, key derivation, rebinding.
- `api/oss/src/dbs/postgres/channels/identity_*` — **new** (dbas/dbes/dao/
  mappings for the identity link table(s), following the same
  dbas→dbes→dao→mappings layering `entities.md` uses throughout).
- WP7's table definitions land as **rows in WP1's migration file**
  (`oss000000021`) — WP7 authors that portion of the migration content and
  hands it to WP1 to include; WP7 does not create or own the migration file
  itself.

WP7 does not touch `tasks/asyncio/channels/inbox.py` (WP4 owns it) even though
WP4 calls into WP7's service — WP7 exposes the interface, WP4 calls it.

## Interfaces

The key shape is driven entirely by the adapter's `identity` capability block
(`capabilities.md` §2–§3):

```json
"identity": { "scope": "workspace", "stable": true }
```

- `scope: "workspace"` (or a channel-specific tenant boundary) means the
  platform's user id is only unique *within* that scope — the link key must
  embed the scope id (e.g. Slack team id + Slack user id), or two different
  Slack workspaces' `U012ABC` collide on one Agenta account.
- `scope` absent or a global-uniqueness value means the platform's user id
  alone is a correct key, and embedding a scope id would be noise (per
  `capabilities.md` §3 "identity": *"embedding a workspace id is correct on
  some platforms and noise on others"*).
- `stable: false` means the platform's user id can change under an existing
  link (`capabilities.md` §3) — WP7 must expose a rebinding path for that
  case, not treat the old key as permanently valid.

```python
# core/channels/identity.py

class ChannelIdentityService:
    async def resolve_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        external_user_key: str,   # composed per the identity capability block, one function
    ) -> Optional[ChannelIdentityLink]:
        """Look up an existing link. None means unlinked — the caller decides
        what an unlinked user may still do (D9: fill without a turn needs no
        identity; a trigger does)."""
        ...

    async def create_link(
        self,
        *,
        project_id: UUID,
        user_id: UUID,            # the Agenta account
        connection_id: UUID,
        external_user_key: str,
    ) -> ChannelIdentityLink: ...

    async def rebind_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        old_external_user_key: str,
        new_external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        """Only reachable for adapters declaring identity.stable == false."""
        ...
```

```python
# core/channels/types.py (WP1-owned file; WP7 supplies these exception
# classes in its own module and they compose the same way) — the refusal:

class ChannelAgentRefused(ChannelsError):
    """D17: one message, three causes, no differentiation.

    Raised identically whether the slug does not exist, exists outside this
    connection's roster, or is in the roster but not granted in this space.
    """
    def __init__(self, *, slug: str):
        self.slug = slug
        super().__init__(f"No agent named `{slug}` is available in this space")
```

Note: `ChannelAgentNotFound` and `ChannelAgentNotGranted` already exist as
distinct exception classes in `entities.md` §5 (WP1-owned `types.py`) because
each carries a different identifying attribute useful for *internal*
diagnosis (`agent_id`/`slug` vs `agent_id`/`space_id`). **WP7's contract is
that whatever surfaces to the user from either of those, plus the
agent-does-not-exist-at-all case, renders through one shared formatting
function producing the identical sentence above** — the internal exceptions
may stay distinct for logs; the user-facing text must not.

## Contracts this package must honour

- **Refusal names the slug, never the reason (D17).** The one sentence —
  *"No agent named `finance` is available in this space"* — is identical
  whether: (a) no agent with that slug exists in this connection's roster at
  all (`ChannelAgentNotFound`), (b) the agent exists in the roster but has no
  grant for this space at all (would-be `ChannelAgentNotGranted` with zero
  grant rows), or (c) the agent has grants but none for this space
  (`ChannelAgentNotGranted`, `entities.md` §5's actual case). Echoing the
  requested slug back is explicitly not a leak (the user typed it); what
  would leak is differentiating the three causes, which is exactly what
  would let someone enumerate which agents exist where. A typo is therefore
  usefully reflected, not swallowed.
- **The key shape is derived by one function per the `identity` capability
  block, no exceptions** — same discipline as `external_key` composition in
  `entities.md` §2.2 ("One function composes it, no exceptions... the moment
  two code paths build keys, one place maps to two threads"). WP7 must not
  let a second call site compose a link key by hand.
- **`stable: false` needs a rebinding path, not a dead link.** Where the
  adapter declares `identity.stable == false`, an existing link keyed on a
  platform user id that has since changed must be re-keyable to the new id
  without losing the underlying Agenta account association — a stale key
  must degrade to "ask the user to re-link," never to silently misattributing
  a turn to the wrong account.
- **The credential used for a turn is the invoking (linked) user's**, per D2
  — WP7's `resolve_link` is what WP4 calls to get from "this platform user
  said this" to "run this turn as this Agenta user." An unlinked user
  producing a trigger is a case WP4 must handle (e.g. prompting to link) but
  the *decision* of unlinked-vs-linked is WP7's lookup, not WP4's guess.
- **No migration file in this package.** WP7's tables are content inside
  `oss000000021`, which WP1 owns end to end (applies and downgrades as one
  migration). WP7 supplies the table/column definitions to WP1; WP7 never
  runs `alembic revision` itself.
- **Follows the same dbas→dbes→dao→mappings layering as the rest of
  channels** (`entities.md` layout, `core/channels/` directory convention) —
  no shortcut collapsing the DAO interface into the service.

## Tests

- An unlinked user's first attempt to trigger an agent surfaces a state WP4
  can act on (e.g. "not linked") distinguishable internally from D17's
  refusal — being unlinked is not one of the three causes D17 unifies, and
  must not be worded to match D17's sentence (that would be its own
  information leak in the other direction: implying no agent exists when the
  real issue is the user is unlinked).
- A linked user's resolved link returns the correct `user_id`, and a turn
  invoked through it is attributed to that Agenta account, not to a service
  or system identity.
- Given a `scope: "workspace"` capability block, two different connections
  (workspaces) with the same platform user id resolve to two independent
  links, never colliding.
- Given a capability block with no `scope` (or a global-uniqueness value),
  the platform user id alone is sufficient to resolve the link — no
  workspace/tenant id is required or read.
- Given `identity.stable == false`, `rebind_link` re-keys an existing link to
  a new external user key while the underlying `user_id` and the link's
  identity (row) are preserved — attribution history does not fork.
- Given `identity.stable == true`, no rebinding path is reachable or needed;
  the key never changes under an existing link.
- Refusal text is byte-identical across all three D17 causes: slug does not
  exist anywhere in the connection's roster, slug exists but has zero grants,
  slug exists with grants but none covering this space.
- Refusal text names the exact slug the user typed, including a typo'd slug
  that matches no real agent.
- No test or code path constructs a link key by any means other than the one
  key-composition function.
- The migration that creates WP7's tables is `oss000000021` (WP1's), and no
  separate revision file exists anywhere in the diff this package produces.

## Out of scope

- The routing decision of *whether* an agent was addressed at all (sigil
  parsing, default-grant fallback, default-agent fallback) — WP4
  (`architecture.md` §5 Step 3).
- Grants and policy resolution (`resolve_policy`) — WP1
  (`entities.md` §1, D25).
- The actual invoke call and turn minting — WP4 (`architecture.md` §5 Step 6).
- Any UI for linking/unlinking accounts — WP13 (web app), built against
  WP8's configuration API, not against this package directly.
- The capability declaration itself, including the `identity` block's shape
  — WP2 (`capabilities.md`, adapter port).
- The migration file's structure, revision chain, and apply/downgrade
  correctness — WP1 owns `oss000000021` in full; WP7 only supplies content.

## Checkpoint

WP7 feeds **C2 — A mention becomes a turn**. Its exit condition, verbatim
from `plan.md`:

> end to end with a fake adapter — mention in, answer out, in the right
> thread, attributed to the linked user. An unaddressed message writes its
> log row and nothing else. Two agents in one thread run independently. A
> mention during a running turn is retried until accepted, never dropped,
> never duplicated.

C2 merges WP4, WP7, and WP5 against polling, needing C1. WP7's own done
condition, verbatim from `plan.md`:

> an unlinked user can link, a linked user's turn is attributed to them, and
> refusals are indistinguishable across the three causes.
