# IM-2-00 specification: the seed review

Review and merge `WP-2-00` on both branches, gateway first. Four nodes fork from this point and
import these names, so a shape corrected after the fork is a conflict in four worktrees.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| The gateway imports no EE module | grep the diff, and read the test that asserts it |
| The null pair is the default | construct `GatewayPolicyService` with no seam arguments and assert both ports are null |
| A flag-off deployment is unchanged | with the null pair bound, a relay's observable behaviour is today's: same response, same audit event, no wallet read and no stream write. Not byte-identity — two awaited calls are added and they return immediately |
| Every field earns its place | walk the field-role table in the specification aloud; a field whose role does not match its parent object moves now, not later |
| The component vocabulary can carry MCP and sandbox time | name the components an MCP call and a sandbox hour would emit; if either needs a sixth key, add it now |
| The cache split is a superset of every protocol | check each of the three protocols' usage payloads against the four token fields; a protocol whose accounting cannot be expressed is a blocker |
| `check` changed its return type and nothing else | the allow/reject boundary tests assert the same thing they did before |
| No envelope was redesigned | `MeasurementCommandV1` and `DebitCommandV1` differ from Wave 1 by exactly one additive optional field, `secret_origin` |
| `record`'s new arguments are optional and gated | `list_models` and both denial paths still compile and still publish an audit event; the sink-gating condition is written where the signature is |
| Tests pass | `oss/tests/pytest/unit/gateways` and `ee/tests/pytest/unit` |

## Output

Two reviewed commits, their SHAs recorded in `wave-2.md` as the fork point, and the list of
public names the four downstream nodes may import.
