# WP15 tasks — Mock channel

Read `specs-wp15.md` first, then `c1-merge-notes.md` (the seam lesson — this
package's whole job is to be a collaborator that is *not* faked).

## The adapter

- [ ] `core/channels/adapters/mock/__init__.py`.
- [ ] `MockAdapter(ChannelAdapterInterface)` in `adapter.py`, `channel = "mock"`.
  Every varying value is a constructor parameter — no `datetime.now()`, no
  `uuid4()`, no sleeps. A test asserting a receipt or an idempotency key must get
  the same value on every run.
- [ ] `fetch_capabilities` returns the declaration handed to the constructor, so
  one class covers every capability shape.
- [ ] `verify_signature` checks a shared-secret header whose name and expected
  value are constructor parameters, defaulting to the scheme WP2's contract suite
  uses. Raise `ChannelSignatureInvalid` on mismatch — same exception a real
  adapter raises, no mock-specific type.
- [ ] `parse_event` pops the next scripted event; `None` when exhausted.
- [ ] `post_message` / `edit_message` record and return a synthetic
  `external_locator`-shaped receipt.
- [ ] `discover_spaces` returns a configured list.
- [ ] `fetch_history` returns a configured list, or raises
  `ChannelBackfillRefused` when the declaration says no history.

## Capability builders

- [ ] `capabilities.py` exposes builders, not one constant: `full()`,
  `no_threads()`, `no_buttons()`, `no_history()`, and `declare(**overrides)`.
- [ ] `conversation.units` is `List[ChannelKeyGrain]` — the vocabulary is
  `{thread, space}`, **not** `ChannelSessionScope`'s `{thread, message}`. These
  two enums both spell a member "thread" and confusing them shipped a broken DTO
  in C0. A channel with no threads degenerates to `space`, never to `message`.
- [ ] `no_threads()` must produce a declaration that `resolve_policy` degrades to
  `MESSAGE` scope, and a test should assert that rather than assume it.

## Script and recorder

- [ ] `script.py`: a scripted inbound queue of `ChannelInboundEvent`, and a
  recorder capturing every post/edit with its content, target and idempotency key.
- [ ] The recorder is the assertion surface — keep it inspectable (ordered list,
  plain dicts), not a mock framework object.

## Tests (unit only — `mock` has no runtime dependency by construction)

- [ ] WP2's contract suite against `MockAdapter`, **unmodified**.
- [ ] If the suite cannot pass unmodified, that is `F5` and the fix belongs in the
  suite — but WP6's Slack adapter must still satisfy the changed suite. Do not
  weaken `mock` to fit a suite that is itself wrong, and do not change the suite
  without checking Slack against it. Report the decision either way.
- [ ] One test per capability arm: each of `no_threads`, `no_buttons`,
  `no_history` against its supported counterpart, asserting the degradation
  `capabilities.md` specifies.
- [ ] Recorder contract: posts ordered, edits target the stated row, a redelivered
  idempotency key produces no second post.
- [ ] Registry reachability: `registry.get("mock")` returns the adapter, so it is
  a registered channel and not only a test import.

## Definition of done

- [ ] Contract suite green against `mock` with no adapter-local override.
- [ ] Every `capabilities.md` capability has a `mock` declaration exercising both
  arms.
- [ ] Unit tests pass with **nothing running** — no Postgres, no Redis, no api.
  That is the layer rule and this package has no excuse to need any of them.

## Out of scope

- The bridge (WP12) — `mock` here is in-process only.
- A public ingress route for `mock`. `_PUBLIC_ENDPOINTS` is WP3's line, and a
  mock channel accepting unauthenticated HTTP is not something to add casually.
