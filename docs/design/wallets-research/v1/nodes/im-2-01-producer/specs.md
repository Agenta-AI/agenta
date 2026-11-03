# IM-2-01 specification: producer and price fan-in

Merge and review the measurement producer and the rate card. One package emits a measurement
and the other prices it, and they were built in worktrees that could not see each other. This
is the review that catches a measurement the card cannot price.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| The non-streaming path records | read `WP-2-01`'s proxy-level drain test and its result; this is the finding the wave rests on |
| Every component the card needs, the producer emits | list the emitted keys and the priced keys side by side. A priced key the producer never emits is the failure this node exists to catch. The reverse is allowed and expected: `request_count` is emitted on every LLM measurement and priced at nothing there, deliberately |
| The cache split survives the whole path | one real usage payload per protocol, through the producer, into a command, through `calculate_charge`, to a hand-computed figure |
| `secret_origin` is produced for `builtin` | read `_outcome_from`, which `WP-2-01` gives a `target` parameter: a `builtin` target stamps `LOCAL` even though it resolves no secret. A miss here costs an audit trail, not a charge — `WP-2-02` charges on the namespace and uses the stamp only to veto a `vault` call |
| MCP still charges | drive `fakes/mcp.py`, the only MCP producer there is, through `calculate_charge` and get the rate `calculate_fake_charge` gave. Its `endpoint_kind` must have moved to the namespace vocabulary and its locator must key the rate by `server`. Wave 1 delivered that path and this wave must not quietly drop it |
| The three conversions are right | `resource_key` starts `llm:` and not `GatewayPlane.LLM:`; `endpoint_id` is a string when there is one and absent when there is not, never the literal `"None"`; `references` is grouped. Each is a silent corruption, and the first breaks restricted-credit selection |
| No file was edited from two worktrees | `WP-2-01` added a new integration module and `WP-2-02` changed the existing one's vocabulary. If both touched the same file, the merge is hiding a decision |
| Nothing prices on the request path | grep the relay's call graph for a rate-card import |
| The charge is integral and rounds once | read the arithmetic, not the tests |
| The version stamp binds | change a rate in a scratch commit and confirm the version test fails |
| No measurement is suppressed | a customer-funded call still produces a measurement row, with no debit |
| Tests pass | the gateway unit and integration suites, `ee/tests/pytest/unit`, and the measurement integration suite |

## Output

A reviewed branch on each side, the worked pricing example recorded, and the drain finding
written down whatever it turned out to be. Released to `WP-2-03` and `WP-2-04`.
