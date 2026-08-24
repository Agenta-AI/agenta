# Runner replay fixtures

Captured cold-Pi-turn wire fixtures for the replay test
(`tests/pytest/integration/execution/test_replay_cold_pi_turn.py`). Capture them with the
`agent-replay-test` procedure described in `docs/design/agenta-local-poc/plan.md`
(Slice 1, "Runner source-checkout proof" + capture steps), then commit:

- `cold_pi_turn.request.json` — the redacted outbound `POST /run` body the SDK sent.
- `cold_pi_turn.ndjson` — the recorded runner response stream (one JSON record per line).
- `cold_pi_turn.result.json` — `{"assistant_text": ...}` folded from the same run.

Capture with the same inputs the tests use and redact secrets, tokens, paths, timestamps,
generated ids, ports, and hosts before committing. The committed fixtures were captured
with exactly:

- instructions: `"You are a terse assistant. Reply with exactly one short sentence."`
- prompt: `"Say hello in exactly five words."`
- provider/model: `openai` / `gpt-4o-mini`
- credential api_key redacted to the literal `sk-redacted` (the replay test constructs its
  `ExecutionCredential` with that same literal so bodies match byte-for-byte).

Until all three files exist, the replay test skips cleanly.
