# IM-2-02 specification: the deployment fan-in

Merge and review admission and wiring on top of `IM-2-01`. This is the node that is deployed
locally and run against; checkpoint 2 is declared from its result.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| One call, one posting | the acceptance test, read rather than trusted |
| Two calls, two postings | the repetition case; redelivery and repetition are different and both must be right |
| A refusal never reaches a provider | the mock adapter records no call on the refusal case |
| The refusal is visible | 403, `code="policy_denied"`, and nothing silently clamped |
| Admission follows permission | the ordering test, and read the call site. A call refused by both records the permission reason, because admission is never reached |
| Admission is scoped to what we pay for | a `standard` relay succeeds against a wallet at its floor. The customer's own credential is not ours to ration |
| The charging surface is stated, not implied | `builtin` is the mock provider behind `env.mock_gateways.enabled`. Say in the acceptance record that checkpoint 2 proves the path and bills nothing real, and that the first platform-funded `builtin` provider is a gateway-wave deliverable |
| The flag off is today's behaviour | both ports null, a relay's observable behaviour unchanged, and the streams absent from `ALL_STREAMS` |
| The wallet moved | a real balance, lower by exactly the posted amount, after a real relay |
| The run dimension is honest | a workflow-invoked call carries `gateway_run_id`; a direct call carries no reference at all |
| Only one entrypoint file changed | `routers.py` on the gateway side, and nothing else |
| Tests pass | every suite either branch touched this wave, with counts |

## Output

A locally deployed stack with the flag on, the acceptance run recorded the way
`nodes/im-1-02-pipeline/acceptance.md` records Wave 1's, and checkpoint 2 either declared or
explicitly not.
