# Proposed release-gate changes

This page proposes how the standing agent release gate should change to cover gateway
tools. The current gate is the `agent-release-gate` skill at
`.agents/skills/agent-release-gate/SKILL.md`. The tests this gate step draws from are in
[qa.md](qa.md).

Keep it small. One new cell, one new fixture requirement, and two edits to existing files.

## What the gate covers today

The gate driver is `.agents/skills/agent-release-gate/resources/qa_product.py`. It runs a
matrix of cells against journeys. The journeys are `chat`, `mount`, `tool`, `approve`,
`deny`, `commit`, `warm`, `cold1`, `cold2`, and `mcp`.

The `tool`, `approve`, and `deny` journeys already prove that the approval machinery works.
They use a builtin or platform tool, not a gateway tool. They prove the pause, the card, and
the resume. They prove nothing about gateway policy compilation or the search filter.

The only existing gateway coverage is
`.agents/skills/agent-release-gate/resources/qa_longctx.py`. Its `gmail` probe runs real
Composio tools. Three limits make it unfit as the gate step for this feature. It is
optional and skipped without live connections. It uses read-only actions only, so it never
raises an approval. It predates the grouped `gateway_connection` format.

## The new cell

Add `.agents/skills/agent-release-gate/resources/matrix_gw1_gateway_tools.py`. Tier:
coached, with one mechanism-blind leg.

It runs one agent with one `gateway_connection` and three tool permissions: one `allow`, one
`ask`, and one `deny`. It asserts four things on the wire and in the stored rows.

| Leg | Asserts | Maps to |
| --- | --- | --- |
| search | `search_tools` returns the allowed and the ask tool. The denied tool key is absent from the tool-output payload. | qa.md R22 to R28 |
| allow-run | `run_tool` on the allowed tool executes with no approval card. The provider side effect is real. | qa.md R2, E-journey step 13 |
| ask-run-approve | `run_tool` on the ask tool pauses. The stored `user_approval` row carries the integration, the tool key, and the arguments. Approving it executes the call. | qa.md R3, R15, R16 |
| deny-run | A direct request for the denied tool is rejected with no callback and no card. | qa.md N2 |

Wire `qa_matrix_lib.check_no_silent_turn` into the pass condition of every leg, as the
skill requires for any new cell. A leg whose pass depends on something not appearing is
satisfied by a turn that did nothing at all.

Reuse `.agents/skills/agent-release-gate/resources/qa_matrix_lib.py` for the session and
turn plumbing and for the approval loop. Do not write new scaffolding.

The mechanism-blind leg is the weak-model journey in
[qa.md](qa.md#weak-model-journey). Phrase the task the way a user types it. Name no tool.
Run it on Haiku. Only this leg licenses a claim about what a small model does unprompted.

## Fixtures the gate needs

| Fixture | Why | Who stocks it |
| --- | --- | --- |
| A seeded Composio test connection in the gate project | The cell cannot run without a real connection. Use a low-risk integration with a reversible write, for example a GitHub issue in a scratch repository. | Release conductor, once per stage |
| `COMPOSIO_API_KEY` on the deployment | The Composio adapter is disabled without it. The API logs "Composio not enabled" at startup. | Deployment env |
| A funded provider vault key | Same requirement the existing cells carry. | Already covered by the gate |

The cell must SKIP with the exact missing name when the connection or the key is absent.
Follow the pattern in `matrix_w7_per_harness.py`. A SKIP here is an untested authorization
claim. Name it in the release summary, as the skill already requires.

The write target must be reversible and scoped to a scratch resource. `qa_longctx.py`
excludes `GMAIL_REPLY_TO_THREAD` for this reason. Keep that rule.

## Automated versus live QA

| Covered by the new cell | Stays live QA |
| --- | --- |
| Search filter, allow, ask, approve, deny, on the wire | The permission drawer, its presets, and the override count |
| The stored approval row shape | The add-integration drawer and the connect flow |
| The provider side effect | The deprecated badge on a legacy group |
| The weak-model discovery rate | The OAuth consent screen on the provider's own page |

The browser steps stay manual for the same reason `matrix_i2_card_journeys.py` stops before
the provider's hosted page. A scripted client cannot drive it.

The compiler truth table, the API route validation, and the runner gate belong in unit
tests, not in the gate. The gate is the product-level check that the assembled path works.

## What this extends rather than duplicates

| Existing gate item | Change |
| --- | --- |
| `qa_product.py` journeys `tool`, `approve`, `deny` | No change. They keep the builtin probe. The new cell is the gateway equivalent. |
| `qa_longctx.py` `gmail` probe | Update it to the `gateway_connection` format, or retire it once the new cell passes. Do not keep two gateway probes. |
| `resources/coverage.md` | Add one row for the new cell, with its requirements, as every cell has. |
| `SKILL.md` resources list | Add one bullet for the new cell. Name its tier. |
| `qa_matrix_lib.py` | Import only. Add a gateway approval helper there if the approval loop needs one, so a later cell can reuse it. |

The cell is not MANDATORY on its first release. Promote it to MANDATORY once it has passed
on two consecutive releases. The lifecycle cells followed that path.
