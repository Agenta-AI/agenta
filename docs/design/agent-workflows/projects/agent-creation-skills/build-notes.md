# Build notes: agent-creation skills

Overnight build, 2026-06-26. Session-authored decisions and judgment calls. The user was
asleep and authorized child subagents for the research.

## What was built

- `README.md` — design doc + verified API reference for agent creation.
- `skills/create-agenta-agent/` — SKILL.md + reference.md + runnable `create_agent.py`.
- `skills/self-host-agenta/` — SKILL.md + reference.md.
- `custom-tools-design.md` — design note for the agent-self-creation tools.

The skills live under this project workspace as drafts. When approved they move to
`.agents/skills/<name>/` (symlinked into `.claude/skills/`), matching the repo convention.
They were NOT placed there yet, to keep the PR a reviewable proposal rather than a live
behavior change.

## Live verification (this is the load-bearing part)

Everything in the skills was run against the live dev stack on 2026-06-26:

- Host `http://localhost:8280`, project `hotel-agent`
  (`019e8df5-635d-7261-85db-d40eb02a1f38`), API key from
  `examples/python/hotel_agent/draft/.env`.
- Full loop verified: create workflow -> create variant -> commit revision (agent config) ->
  invoke. Returned "The capital of France is Paris." and "The capital of Japan is Tokyo."
- Update verified: a second commit appended version `1`; revisions log showed both.
- Secrets verified: list, create (fake anthropic key), delete (cleanup) round-trip.
- Tools verified: catalog providers (1 = composio, 1047 integrations), github actions search
  (846 total), `/tools/resolve`.
- Harness capabilities pulled live from `/inspect` for all three harnesses.
- The bundled `create_agent.py` ran end to end with `--archive` and cleaned up after itself.
- All test workflows were archived. The fake secret was deleted.

## Decisions and judgment calls

1. **`parameters.agent`, not `ag_config`.** The brief and a memory note call the payload
   `ag_config`. The code has no such key. The catalog *type* is `agent_config`; the payload
   *location* is `data.parameters.agent`. The skills use the correct name and call this out
   explicitly as a gotcha, since the wrong name is in circulation.

2. **`data.uri`, not `data.url`.** The first commit attempt used `url` and got a 422 ("Invalid
   URL format") because `url` is validated as an HTTP(S) URL. The builtin scheme
   `agenta:builtin:agent:v0` only fits `uri`. Found by reading
   `sdks/python/agenta/sdk/models/workflows.py`. Documented as a gotcha.

3. **Variant request wrapper renamed.** The manual `.http` test files use `variant` /
   `artifact_id`; the live API now wants `workflow_variant` / `workflow_id` and 422s
   otherwise. The skills use the current shape and note the drift.

4. **Did not test the Claude harness live.** The b2-rendering stack points at its own
   API-key sidecar (`sandbox-agent:8765`), and the subscription sidecar (`:8790`) is a
   separate, deliberately-unwired container. Repointing the running stack to test Claude
   risked disrupting the live deployment, against the hygiene rule. Claude harness selection
   and capabilities are documented from the verified `/inspect` output and the
   subscription-sidecar README (which records its own 2026-06-25 verification) rather than
   re-run. The create/commit/invoke loop is harness-agnostic, so the Pi verification covers
   the mechanics; only the harness string and provider differ for Claude.

5. **Cheap models only.** Used `gpt-4o-mini` for every live invoke, per hygiene.

6. **Custom-tools note is design-only.** Per the brief. It maps each proposed tool to an
   existing, verified endpoint and to the harness tool path, but proposes no implementation.

7. **Skill structure follows Anthropic's published guidance** (researched live): short
   SKILL.md (the procedure), heavy reference split into a bundled `reference.md` loaded on
   demand, a runnable script for the deterministic path, and a description written in third
   person packed with when-to-use triggers. `allowed-tools` + `user-invocable` match the
   repo's existing skills.

## Follow-ups (not done here)

- Live-verify the Claude harness via the subscription sidecar on a throwaway stack (not the
  running one), then pin a replay test with the `agent-replay-test` skill.
- When the skills are approved, move them to `.agents/skills/` and add the symlinks.
- The custom-tools note's open questions need a product call (reserved provider vs builtin
  names; self-only vs general update; budget guard wiring; annotation auto-on; bundle vs
  individual).
- Consider a `fetch_config_schema` example that pulls the live `agent_config` JSON Schema
  from `/api/workflows/catalog/types/agent_config` so a builder agent can self-describe the
  config (endpoint exists; not exercised this session).
