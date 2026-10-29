# WP19 tasks — the bridge `source` contract

Read `specs-wp19.md`, then `contract.md` in full — especially §3 (transport) and §5
(the envelope), plus the `OPEN: what source is for` section this package closes. Then
`findings.md` for `F37`.

**Two phases, in order. Do not start phase 2 before phase 1 is written down.**

## Phase 1 — decide, in the contract

- [ ] Replace `contract.md`'s `OPEN: what source is for` with a decision. State which
  of the three candidates wins and **why**, in terms of what is trusted:
  `source` authoritative / credential authoritative / credential decides with `source`
  as a cross-check.
- [ ] Say what happens on a mismatch between `source` and the credential — refuse,
  ignore, or log. A reader must not have to guess.
- [ ] Decide the **channel key for a bridged platform** and record it. Weigh the
  constraint that `ConnectionProviderKind` is a three-member `(str, Enum)` a third
  party cannot extend, so a per-bridge enum member does not scale.
- [ ] Say whether `source` remains required on the wire once it is not authoritative.
  A field that is required but unused invites a bridge to fill it wrongly.
- [ ] **Write it as protocol, for an external reader.** A bridge author has this
  document and nothing else — no access to our source, no context from this project.

## Phase 2 — implement exactly that

- [ ] Resolve the bridged channel from whatever the contract now says is
  authoritative, replacing the literal `channel="bridge"` at `ingress.py:104`.
- [ ] **The order problem:** `_ingest` calls `adapter_registry.get(channel)` *before*
  `verify_signature`, but a credential-derived channel is unknown *until* verification.
  Restructure the bridge arm accordingly.
- [ ] **The Slack arm must not change behaviour.** It is a literal-path channel whose
  key is known before verification; do not force it through the bridge's order.
- [ ] Confirm `_PUBLIC_ENDPOINTS` still needs exactly its current four bridge entries —
  the route does not change, only what happens after it.
- [ ] If the channel-key decision requires widening `ConnectionProviderKind`, do it in
  `core/gateway/connections/dtos.py` and check every `.value` call site: eight of them
  broke last time a change was attempted there.

## Tests

- [ ] Unit: resolution from a verified credential, with a faked registry and service.
- [ ] Unit: a `source`/credential mismatch behaves as the contract now says.
- [ ] Unit: an unknown bridge is refused, and the refusal leaks nothing about which
  part failed — the same discipline the signature path already follows.
- [ ] Do **not** write the two-bridge end-to-end test here. That is WP17's, it needs a
  real process, and claiming it at unit level would be claiming something untested.

## Definition of done

- [ ] No `OPEN` section remains in `contract.md` on this subject.
- [ ] The ingress no longer keys on the literal `"bridge"`.
- [ ] The Slack arm's behaviour is unchanged, asserted by the existing tests passing
  untouched.
- [ ] `ruff format` / `ruff check` clean; canonical api run green from the repo root.

## Report explicitly

- [ ] The decision and the reasoning, in a form WP12 can implement against directly.
- [ ] Anything in `contract.md` that a second reading found ambiguous. A bridge author
  will hit exactly those, and this is the last cheap moment to fix them.
- [ ] Whether `ConnectionProviderKind` had to change, and what broke if so.
- [ ] What you did **not** prove — specifically that two bridges coexisting is WP17's
  claim, not this package's.

## Out of scope

- `BridgeAdapter` (WP12), which consumes this decision.
- The two-bridge proof (WP17).
- Any second bridge implementation, or any named platform.
