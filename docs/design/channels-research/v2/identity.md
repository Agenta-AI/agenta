# Linking a platform user to an account

Half of this exists: a table, a canonical `external_user_key` per the adapter's
declared identity block, and a service that resolves a link or returns `None`.
Nothing **creates** a link. So every platform user is permanently unlinked, and the
`None` branch is the only one ever taken.

## What a link is for

`resolve_link` returning `None` means unlinked, and the caller decides what an
unlinked user may still do. That split is already right and worth keeping:

- **fill needs no identity** — a message can join the context of a conversation
  without anyone being linked.
- **a turn does** — running an agent means acting as somebody, against their
  permissions and their quota.

So the question a link answers is *whose permissions does this turn run under*, not
*who is speaking*.

## The three cases, and only one is hard

**Agenta as a channel: no linking at all.** The user is already authenticated on our
own surface, so the account is known before the message exists. The link is implicit
and needs no flow. This is worth stating because it makes the first channel we can
fully drive also the one that skips the hardest part — a reason not to treat web as
proof that identity works.

**A platform user who is already an Agenta user.** The common case. They exist in
both places and nothing connects the two.

**A platform user with no account.** Either they are refused, or a turn runs with no
identity and therefore no permissions. That is a product decision, not a technical
one, and it should be explicit rather than falling out of a `None`.

## The flow

The only mechanism a chat platform offers is a link the user clicks, and the only
thing we control on the other side is our own session. So:

1. An unlinked user addresses an agent.
2. We answer in-thread with a link carrying a **short-lived, single-use token**
   bound to `(project, connection, external_user_key)`.
3. They open it, authenticate on Agenta if not already, and confirm.
4. We write the link and answer in the thread that they are connected.

Three properties that are not optional:

- **The token proves the platform identity, not the account.** It is minted from an
  event we verified, so we know the platform user is real. The account comes from
  their own authenticated session on our side.
- **Single-use and short-lived.** A link posted in a shared channel is visible to
  everyone in it. Anyone else clicking it must get nothing.
- **Scoped to a connection.** Being linked in one workspace does not link you in
  another, because the same platform account can be a different person's in a
  different tenant.

## Rebinding, which the DAO already anticipates

`rebind_link` exists, which is right: a platform user key can change while the human
does not. What has to be decided is when it may be called — a rebind is a
**re-authentication**, never an automatic follow. Silently following a changed key
is how one person inherits another's link.

## What this needs from elsewhere

- **A pending state on the thread.** The same mechanism a pending choice uses: we
  asked something, we are waiting. Identity is one more thing that can be pending.
- **A rendered link that degrades.** On a text-only surface it is a bare URL, which
  is fine — but it is another node type with a fallback.

## Open, deliberately

- **Unlinked-user policy** — refuse, or run without permissions. Product decision.
- **Whether an admin can link on someone's behalf.** Convenient, and it means an
  admin can cause an agent to act as another person. Probably no.
- **Group DMs and multi-party threads**, where several senders alternate and only
  one is linked.
