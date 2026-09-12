# QA plan

## Contract tests

### Python

- Accept every effort literal.
- Reject unknown strings and non-string values.
- Treat omission as default.
- Prefer first-class effort over legacy extras.
- Normalize legacy `none` to `off`.
- Preserve arbitrary extras.
- Propagate through Pi and Claude harness adapters.
- Emit explicit effort on the wire and omit default.
- Keep default golden requests unchanged.

### TypeScript wire

- Describe the same literal union as Python at compile time.
- Pin the request key set in `wire-contract.test.ts`.
- Add runtime DTO tests in the Python/service path because TypeScript types do not validate incoming JSON.
- Do not claim unrelated unknown-key rejection unless this feature adds a runtime request validator.

### Capability negotiation

- HTTP health and subprocess `--info` expose the same `features.reasoningEffort` version.
- Explicit effort proceeds only when capability version 1 is present.
- Missing, malformed, timed-out, and unreachable probes fail closed before `/run` for explicit effort.
- Probe results are cached per backend instance without crossing runner URLs or commands.
- Omission/default may use an old runner during staged rollout and keeps legacy no-reset behavior there.
- Outer capability never counts as Daytona adapter evidence; the session must still pass runtime category and readback checks.

## Runner unit tests

- Call order is create/resume, model, effort, prompt.
- A supported explicit value is applied and read back.
- Missing thought-level category fails for explicit effort.
- Unsupported value lists the advertised values.
- A clamped adapter-reported value fails for explicit intent.
- Default requests Pi medium on a reasoning model; a default-only clamp is accepted and recorded.
- Default maps to Claude default when advertised.
- Default is a no-op only when no category exists.
- A reasoning change changes the session fingerprint.
- A resumed session reapplies effort without losing history.
- Removing high resets the next turn to default.
- No effort operation occurs before model selection.
- Claude operator precedence is tested separately from ACP readback before the trace calls any value provider-effective.

## UI unit tests

- Read and write every option.
- Model default deletes only `reasoning.effort`.
- Empty reasoning objects are removed.
- Non-empty future reasoning keys are preserved.
- Extras, model, provider, and connection are preserved.
- Legacy values display correctly without rewriting until the user edits.
- Model/harness switches preserve a saved selection.
- Always-present model-support guidance is accessible and does not block saving.

## Live matrix

Run locally first through the subscription sidecar, then repeat on Daytona only after its image is upgraded.

| Harness | Model case | Effort | Expected |
| --- | --- | --- | --- |
| Pi | reasoning model | high | Config readback high; prompt succeeds. |
| Pi | reasoning model supporting medium | default after high | Readback medium; no high leakage. |
| Pi | model that clamps default medium | default | Clamp accepted as model default and adapter-reported value recorded. |
| Pi | non-reasoning model | high | Clear pre-prompt unsupported error. |
| Pi | model without max | max | Clear allowed-value error, no clamp. |
| Claude | Sonnet or Opus | low | Readback low; prompt succeeds. |
| Claude | model-specific unsupported level | explicit | Clear allowed-value error. |
| Claude | default after high | default | Adapter readback reports default; provider behavior is verified separately. |
| Both | warm second turn | same effort | History preserved and effort remains effective. |
| Both | warm second turn | changed effort | New config applied before next prompt. |

## Regression capabilities

For both harnesses where supported:

- text and thought event streaming;
- HTTP MCP tool call;
- allow, deny, and ask permission flows;
- parked approval resume;
- cancellation;
- session resume/load;
- usage aggregation;
- process-tree cleanup.

Claude needs an additional background Agent/subagent permission test because upstream issue #851 reports a possible permission-channel deadlock.

## Adapter dependency evidence already collected

- Frozen install from current `big-agents`: passed.
- Runner typecheck: passed.
- Focused ACP/model/provider tests: 44 passed.
- Rebuilt local runner and Claude subscription sidecar: adapter 0.58.1 in both.
- Live sidecar and app health: passed.
- Claude Sonnet config: effort category found; low applied and read back.
- Claude Sonnet normal run: returned `EFFORT-ADAPTER-OK`.

The dependency PR's full suite reached 826 of 829 tests. The remaining permission microtask timing assertion and two Pi replay failures reproduce outside the focused dependency path and should be tracked separately if they remain on CI.

## Acceptance evidence

Capture for each live cell:

- image and package versions;
- harness and model;
- requested and adapter-reported effort, plus separate provider-precedence evidence where available;
- session id and whether it was cold, warm, or resumed;
- exact prompt assertion;
- relevant runner logs;
- tool/permission result when exercised;
- cleanup confirmation.

Promote stable passing captures into agent replay tests where the ACP response can be safely redacted and replayed.

