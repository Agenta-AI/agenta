# Direct-call tools (Workstream A)

Make resolved agent tools carry their own call target, so the sidecar calls reference and
platform tools directly and only gateway (Composio) tools route through the central
`/tools/call`.

## Files in this workspace

- **`plan.md`** — the hand-off and the two-workstream split (A here, B on PRs #4860/#4877),
  plus the Workstream A execution phases. This is the file the orchestrator was pointed at.
- **`context.md`** — why this exists: the conversation, the decision, goals and non-goals.
- **`research.md`** — the actual code seams with file:line, and the nuances that shape the
  design (reference still needs the API; the args-placement wrinkle; the schema catalog).
- **`design.md`** — the technical design: the `call` descriptor, the dispatch algorithm, the
  per-tool-type table (config → resolved → dispatch), the platform-op catalog.
- **`status.md`** — current state, what Workstream B is doing concurrently, open decisions,
  next step. Source of truth for progress.

## One-line state

Planning. No code yet. Workstream B is active in parallel on the reference tool (PRs #4860 /
#4877); the shared file `sdks/python/agenta/sdk/agents/tools/models.py` must be serialized.
See `status.md`.
