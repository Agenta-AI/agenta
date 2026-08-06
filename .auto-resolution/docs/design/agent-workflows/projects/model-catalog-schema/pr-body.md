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

It keeps one authoritative idea and drops the rest. The live harness's accepted set gates every
selection, exactly as today. The catalog is just the list of models the harness accepts, verified
once against that live set, decorated with facts and metadata. There is no separate "advertised"
set and no per-model flag deciding whether to surface a model. If the harness accepts it, it is in
the catalog and the picker shows it. The catalog never gates, so a stale entry can never make a
rejected model selectable.

It designs the catalog entry so concrete facts and curated judgments are structurally distinct.
Real pricing is a `pricing` object of dollar amounts per million tokens. Ratings are a separate
`ratings` object of 1-5 scores (the range is enforced). They are different types with different
names, so a price and a score can never be confused. Identity (`id`, `provider`), provenance
(`source`), and the sourced facts (`name`, `pricing`, `context_window`, `modalities`) sit apart
from the curated fields (`label`, `description`, `ratings`). Everything optional is optional:
Claude has no pricing until curated, Pi has no ratings until curated.

It sources the curated metadata from current public information, not from a model's training data.
Names, descriptions, and ratings state a model's current standing, which goes stale (Claude's top
tier in mid-2026 is Fable, above Opus). The maintaining skill looks up the current lineup and
pricing rather than trusting any model's recollection, and leaves out any fact it cannot verify.

## Before and after

The published field changes from

```json
{ "models": { "anthropic": ["default", "sonnet", "opus", "haiku", "default[1m]"] } }
```

to a list of records:

```json
{
  "model_catalog": [
    {
      "id": "fable",
      "provider": "anthropic",
      "source": "curated",
      "name": "Claude Fable 5",
      "label": "Fable",
      "pricing": { "input_per_mtok": 10.0, "output_per_mtok": 50.0, "currency": "USD" },
      "context_window": 1000000,
      "description": "Anthropic's most capable model. Use for the hardest reasoning and long-horizon agentic work.",
      "ratings": { "cost": 1, "intelligence": 5, "speed": 2 }
    }
  ]
}
```

The catalog lives in data files a skill maintains, not in code: a generated Pi file derived from
the pinned pi-ai catalog, and a curated Claude file. The `sync-model-catalog` skill regenerates
Pi facts on a version bump, seeds Claude facts from pi-ai's anthropic block, reconciles the catalog
to the live accepted set, and refreshes the curated metadata from current public sources.

## Migration

Additive, so nothing breaks at any point. The backend adds `model_catalog` alongside the existing
`models` map. The frontend switches the picker to `model_catalog` (filling an option-metadata seam
that already exists but is unused), showing labels and description tooltips while keeping selection
working and keeping the `models` fallback. Ratings ship in the data and render in a later slice.
The old `models` field is dropped only after the frontend has cut over. The prompt-playground model
picker is a separate consumer and is untouched by design.

## Notes for the reviewer

- The interface heart is `design.md`: the fact-versus-judgment split (pricing versus ratings) and
  the 1-5 ratings decision with its rationale.
- The Fable finding and the full reader map are in `research.md`, traced to file and line.
- `plan.md` sequences this behind the in-flight `capabilities.py` and `connections.py` rework so
  it stacks additively rather than racing it. `open-questions.md` collects the calls for you.

https://claude.ai/code/session_0127AM79khCdvD2b8BG2joZL
