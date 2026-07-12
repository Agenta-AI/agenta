# [docs] Design a curated model-catalog schema for harness model advertising

## Context

The agent model picker shows raw ids like `openai-codex/gpt-5.6-sol` and `sonnet[1m]`, because
Agenta advertises harness models as a flat list of id strings hardcoded in `capabilities.py`.
The list is wrong in three ways. It over-advertises Claude aliases the live harness rejects
(`default[1m]`, `haiku[1m]`), so a strict run fails. It omits ids the harness accepts (a user can
select Fable today, but the list has never carried it). And because it is hardcoded, it drifts
from reality on every harness update.

The root cause is a category error. The published list is treated as the set of valid models, but
the only authoritative set is the one the live harness reports at session init. sandbox-agent
already gates every selection against that live set. The published list is a stale guess sitting
next to it.

## What this PR contains

Design only. No production code changes. A new workspace,
`docs/design/agent-workflows/projects/model-catalog-schema/`, with the research, the schema, the
plan, the open questions, and this body.

The design does three things.

It separates the three sets that today are conflated: the accepted set (live, authoritative, the
gate), the advertised set (static, a hint for the offline picker), and the curated catalog (the
new per-model records). The rule a reviewer can check in one read: the curated catalog never
gates selection, so a curated entry can never make an unaccepted model selectable.

It designs the catalog entry so concrete facts and curated judgments are structurally distinct.
Real pricing is a `pricing` object of dollar amounts per million tokens. Ratings are a separate
`ratings` object of 1-5 scores. They are different types with different names, so a price and a
score can never be confused. Identity (`id`, `provider`), provenance (`source`), and the sourced
facts (`name`, `pricing`, `context_window`, `modalities`) sit apart from the curated fields
(`label`, `description`, `ratings`, `advertised`). Everything optional is optional: Claude has no
pricing until curated, Pi has no ratings until curated.

It handles the Fable case explicitly. An `advertised: false` entry is a model the live harness may
accept but that Agenta does not surface by default. It still carries a label and description, so a
user whose harness offers it sees it cleanly, and the default picker stays curated.

## Before and after

The published field changes from

```
models: { "anthropic": ["default", "sonnet", "opus", "haiku", "default[1m]", ...] }
```

to a list of records:

```
model_catalog: [
  { "id": "opus[1m]", "provider": "anthropic", "source": "curated",
    "name": "Claude Opus 4.8", "label": "Opus (1M context)",
    "pricing": { "input_per_mtok": 15.0, "output_per_mtok": 75.0, "currency": "USD" },
    "context_window": 1000000,
    "description": "Strongest reasoning. Use for hard, multi-step work.",
    "ratings": { "cost": 1, "intelligence": 5, "speed": 2 }, "advertised": true }
]
```

The catalog lives in data files a skill maintains, not in code: a generated Pi file derived from
the pinned pi-ai catalog, and a curated Claude file. The `sync-model-catalog` skill regenerates
Pi facts on a version bump, seeds Claude facts from pi-ai's anthropic block, probes the live
harness for the real accepted set, and reports drift between advertised, curated, and accepted.

## Migration

Additive, so nothing breaks at any point. The backend adds `model_catalog` alongside the existing
`models` map. The frontend switches the picker to `model_catalog` (filling an option-metadata seam
that already exists but is unused), showing labels and description tooltips while keeping selection
working and keeping the `models` fallback. Ratings ship in the data and render in a later slice.
The old `models` field is dropped only after the frontend has cut over. The prompt-playground model
picker is a separate consumer and is untouched by design.

## Notes for the reviewer

- The interface heart is `design.md`: the fact-versus-judgment split, the `advertised` flag, and
  the 1-5 ratings decision with its rationale.
- The Fable finding and the full reader map are in `research.md`, traced to file and line.
- `plan.md` sequences this behind the in-flight `capabilities.py` and `connections.py` rework so
  it stacks additively rather than racing it. `open-questions.md` collects the calls for you.

https://claude.ai/code/session_0127AM79khCdvD2b8BG2joZL
</content>
