# WP19 — The bridge `source` contract

**A design decision first, code second.** `F37`: one
`POST /channels/bridge/events/` serves every bridge — correct and deliberate, since a
bridged platform has no literal path of its own, which is what makes it a bridge. So
the multiplicity is a **wire-contract** property, and the contract already carries the
identifying fields without ever saying what core does with them.

`contract.md` §5 has `"source": "bridge/acme-wecom"` in the envelope example and lists
`source` among the CloudEvents fields. `bridge.hello` declares
`bridge.name: "acme-wecom"`. **Nothing in the code reads either.** The ingress passes
the literal `channel="bridge"`, so `registry.get("bridge")` and
`get_project_and_connection_by_external_id(channel="bridge", ...)` both key on that
constant and every bridged platform collapses into one channel.

This package exists because that decision is the **protocol** every future bridge
author implements against. Made only in `ingress.py`, it becomes something they must
read our source to discover.

## The decision, before any code

Three candidates. They differ in what is *trusted*, which is the whole question:

**`source` is authoritative.** Simplest. But `source` is self-asserted: it arrives
inside the signed body, so it is tamper-*evident*, not *verified*. A bridge could name
another bridge's source and only the signature would disagree with it.

**The credential is authoritative.** Verifying it is already mandatory, and
identifying the caller is the same act — so nothing extra is trusted. Then `source` is
documentation, and the contract must say whether a mismatch is an error or ignored.

**The credential decides, `source` cross-checks.** A mismatch is a hard refusal.
Strictest, and it makes a misconfigured bridge fail loudly instead of silently writing
into another bridge's connection.

**A second question, equally undecided: the channel key for a bridged platform.**
`bridge/<name>`, or a key the bridge declares at `hello`? This is what
`gateway_connections.provider_key` persists and what the adapter registry is keyed on
— stored data, not an implementation detail. Note the shape this has to fit, verified rather than assumed:
`ConnectionProviderKind` is a `(str, Enum)` with exactly `COMPOSIO`, `AGENTA`, `SLACK`
(`core/gateway/connections/dtos.py:20`), stored in a `varchar` column. A per-bridge
channel key therefore means either widening a Python enum for every bridge that ever
registers — which is not something a third party can do — or one enum member for all
bridges with the bridge's own name held elsewhere. **That constraint probably decides
the question**, and it is worth stating in the contract rather than discovering later.

Write the decision into `contract.md`, replacing the `OPEN: what source is for`
section. Then implement it.

## The implementation constraint that rules out the naive fix

`_ingest` does `adapter_registry.get(channel)` **before** `verify_signature`. But a
credential-derived channel is not known **until** verification. So under any candidate
where the credential participates, the bridge arm cannot keep that order.

That is not a detail to discover during coding — it changes the shape of `_ingest`, and
the first-party Slack arm must keep working unchanged.

## Files

- `docs/design/channels-research/v2/contract.md` — the decision, replacing the OPEN
  section. **This is the deliverable**; the code follows it.
- `api/oss/src/apis/fastapi/channels/ingress.py` — the bridge arm's resolution
- `api/oss/src/core/channels/service.py` — only if the channel-key decision requires
  it
- `api/oss/src/core/gateway/connections/dtos.py` — only if `provider_key` must widen

## Test layer

The resolution logic is **unit**-testable with a faked registry and service. Whether
two bridges actually stay distinct end to end is **WP17's** two-bridge test — do not
duplicate it here, and do not claim it.

## Done when

- `contract.md` states what `source` is for, what the channel key is, and what happens
  on a mismatch. No `OPEN` section remains on this subject.
- The ingress resolves a bridged channel from whatever the decision says is
  authoritative, rather than from the literal `"bridge"`.
- The Slack arm is unchanged in behaviour.
- A bridge whose `source` disagrees with its credential does whatever the contract now
  says, asserted by a test.

## Out of scope

- `BridgeAdapter` itself — WP12, which consumes this decision.
- The two-bridge end-to-end proof — WP17.
- Any second bridge implementation.
