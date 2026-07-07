# FINDINGS — replay tests (pin a real captured run)

Test-only change. No production files modified (`git diff --stat` is empty); four new untracked
test files. Nothing committed.

## Transcript shape

Each `docs/design/agent-workflows/projects/qa/runs/*.json` is a real `/invoke` request/response
pair (NOT a raw ACP/sandbox-agent transcript):

- `request.data.{inputs.messages, parameters.agent}`
- `response.data.outputs`, plus `reply` / `passed` / `expect` (the QA program's own verdict)
- Filename = `<env_label>__<id>.json`; `harness` field is `pi` / `agenta` / `claude`;
  `group: "f001"` marks the append_system regression family.

The captures span at least 3 wire-shape generations, documented inline in `qa/matrix.md`:

- `harness: "pi"` → today's `"pi_core"`
- `harness_options.<harness>.append_system` → today's nested `harness.extras` (Python) /
  already-resolved `appendSystemPrompt` (the shared `/run` wire)
- flat `agents_md` / `model` → today's nested `instructions` / `llm`

Handled with one small explicit translator per side rather than papering over the drift.

## Cells replayed

- **F-001 cell:** `E2__append_system_pi.json` (sandbox-agent capture, `passed:false`, `expect`
  names F-001).
- **Two green cells:** `E2__smoke_chat_pi.json` (baseline) and `E2__builtin_bash_pi.json`
  (exercises the tools mapping).

All three are E2 (service/sandbox-agent path) so they exercise `runSandboxAgent` on the TS side.
The E1 in-process capture was deliberately skipped for TS — E1 never reaches the ACP boundary.

## Injection seam

- **TS:** `runSandboxAgent(request, emit, signal, deps: SandboxAgentDeps)` — a purpose-built
  `fakeReplayHarness()` in the new test file (the existing `fakeHarness()` is untouched), with
  `prepareWorkspace` capturing the `RunPlan` so the F-001 test asserts
  `plan.appendSystemPrompt` / `hasSystemPrompt` directly. New `tests/utils/qa-transcripts.ts`
  loads/translates a transcript, mirroring the existing `tests/utils/golden.ts` pattern.
- **Python:** `FakeRunnerBackend` (already used by `test_transport_roundtrip.py`) with a fake
  runner script that echoes the transcript's recorded `reply` (JSON mode for
  `prompt()` / `result_from_wire`, NDJSON for `stream()` / `AgentStream`, keyed on `--stream`
  like the real CLI). A second fake-runner variant captures the *received* request to a file to
  assert the request-shaping half. New `_qa_transcripts.py` loader mirrors the TS one.

## Real-transcript-exposed gap

The first Python draft only asserted on the parsed *result* (`result.output == reply`), which
stays green even if `append_system` extraction is silently broken — because the fake runner
ignores the inbound request and echoes the canned reply. This is exactly the blind spot hand-built
fakes have (they cannot disagree with themselves). Caught via the required perturbation check;
fixed by adding a second test (`test_append_system_override_reaches_the_wire` / the TS F-001 test)
that captures and asserts the *outbound* wire request instead.

## Perturbation verification (all reverted; only new untracked files remain)

1. Python loader with `append_system` extraction dropped — passed the result-only test, correctly
   FAILED the new request-capturing test.
2. TS loader with the same drop — FAILED the F-001 replay test.
3. TS production `run-plan.ts` with `appendSystemPrompt` forced `undefined` (simulating a real
   F-001 recurrence) — both the new replay test AND the pre-existing
   `sandbox-agent-run-plan.test.ts` failed, confirming non-redundant coverage at the
   orchestration-entrypoint layer.

## DRAFT skill: not graduated

`regression-skill-DRAFT.md` is stale in ways that would mislead: its example imports
`InProcessPiBackend` (renamed `LocalBackend`, now a stub per F-018); fixture-placement points at a
`recordings/` dir that doesn't exist; its captured-pair format doesn't match the real QA envelope;
zero mention of the harness-rename / field drift handled here. Graduating it is a real rewrite,
out of scope for test-only work — flagged as a follow-up, with this task's two loader modules as
worked examples.

## No production change was needed or made.

## Test results

- **TS:** `pnpm run typecheck` clean. `pnpm test` — 50 files / 611 tests green (3 new).
- **Python:** new file alone 5/5; `--layer integration` 142/142 (includes the 5 new). Full default
  run — 2214 passed, 4 skipped, 10 xfailed (pre-existing), 97 errors (pre-existing `acceptance`
  tests needing a live stack), 2 failures
  (`test_run_selection_unknown_permission_falls_back_to_allow_reads`,
  `test_unknown_harness_is_permissive`) — confirmed pre-existing, reproduced against the unmodified
  tree, unrelated to any touched file.
- **Collection confirmed:** `oss/tests/pytest/integration/agents/test_qa_transcript_replay.py` sits
  under `testpaths` and is scanned by `run-tests.py`. The pre-existing orphaned
  `sdks/python/agenta/tests/agents/` (4 files) sits outside `{oss,ee}/tests/pytest/` and is never
  collected — the exact trap the task warned about, pre-existing and untouched.

## Files touched (all new, untracked)

- `sdks/python/oss/tests/pytest/integration/agents/_qa_transcripts.py`
- `sdks/python/oss/tests/pytest/integration/agents/test_qa_transcript_replay.py`
- `services/runner/tests/utils/qa-transcripts.ts`
- `services/runner/tests/unit/sandbox-agent-qa-transcript-replay.test.ts`
