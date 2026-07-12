# Design: a curated model-catalog schema

This document designs the per-model catalog entry that replaces the flat id list Agenta
publishes per harness. It separates concrete, sourced facts from curated judgments, states what
is authoritative, and shows a worked entry for a Pi model and two Claude models. The migration
mechanics live in `plan.md`; the schema and its rationale live here.

## The model to hold in your head: three sets, one gate

Three sets of model ids exist. Keeping them distinct is the whole design.

1. The accepted set. The ids the live harness will actually switch to. Its source is the
   harness's own config options at session init: Pi lists `provider/id` for every provider it
   has a credential for; Claude lists whatever the Claude Code SDK build reports. sandbox-agent
   gates every `setModel` against this set (`research.md`, experiment 1). This set is dynamic
   (per project for Pi, per harness build for Claude) and it is the only thing that decides
   whether a selection succeeds.

2. The advertised set. The ids Agenta publishes so the frontend can render a picker without a
   live session. Today this is `CLAUDE_MODEL_ALIASES` plus `_pi_models()`. It is a static,
   best-effort hint. It has drifted from the accepted set in both directions.

3. The curated catalog. The per-model records this project introduces: a clean label, a
   description, real pricing, and relative ratings, keyed by id.

The rule that a pedantic reviewer should be able to check in one read: the curated catalog never
gates selection. The accepted set gates, at run time, exactly as it does today. The catalog only
decorates whichever ids are in play, and the advertised set is only a hint for the offline
picker. A curated entry for a model the harness rejects can never make that model selectable,
because the runtime gate is unchanged. This is the safety property the CTO asked for, and it
falls out of keeping the catalog off the gate path entirely.

## The entry schema

One record per model. The fields split into three groups by semantic role: identity (the join
key), sourced facts (objective, provenanced), and curated judgments (subjective, human). The
split is carried by field grouping and by two distinctly named sub-objects, `pricing` (a real
price) and `ratings` (a relative score), so the two can never be confused.

```python
class ModelPricing(BaseModel):
    """A real, sourced price. Never a rating. Units are USD per million tokens."""
    input_per_mtok: float                      # prompt tokens
    output_per_mtok: float                     # completion tokens
    cache_read_per_mtok: Optional[float] = None
    cache_write_per_mtok: Optional[float] = None
    currency: str = "USD"

class ModelRatings(BaseModel):
    """Curated, relative 1-5 scores. Higher is better on every axis. Never a price."""
    cost: Optional[int] = None          # 5 = most economical, 1 = most expensive
    intelligence: Optional[int] = None  # 5 = strongest reasoning
    speed: Optional[int] = None         # 5 = fastest

class ModelCatalogEntry(BaseModel):
    # --- identity: the join key to the accepted set ---
    id: str                             # the value passed to setModel (Pi: "openai/gpt-5.5";
                                        # Claude: an alias like "opus[1m]")
    provider: str                       # provider family (anthropic, openai, openai-codex, ...)

    # --- provenance of the facts below ---
    source: Literal["pi_generated", "curated"]

    # --- concrete, sourced facts (objective) ---
    name: Optional[str] = None          # vendor/harness display name ("GPT-5.5", "Claude Opus 4.8")
    pricing: Optional[ModelPricing] = None
    context_window: Optional[int] = None  # max input tokens
    modalities: Optional[List[str]] = None  # ["text"], ["text", "image"], ...

    # --- curated judgments (subjective) ---
    label: Optional[str] = None         # display override when `name` is ugly or absent
    description: Optional[str] = None   # one sentence, shown in a tooltip
    ratings: Optional[ModelRatings] = None
    advertised: bool = True             # include in the offline picker set; see below
```

The envelope carries a schema version so the shape can grow without a silent break:

```python
class ModelCatalog(BaseModel):
    schema_version: Literal["1"] = "1"
    models: List[ModelCatalogEntry] = Field(default_factory=list)
```

Each harness's capability record gains this catalog as a field, alongside the existing `models`
map during the migration (see `plan.md`). The list is flat and normalized: `provider` lives on
the entry, not in an outer key, so it has one source of truth. The frontend groups by
`entry.provider` client-side, which it effectively does today.

### Why these fields, and why grouped this way

- `id` and `provider` are the key. `id` is defined as the exact value the harness's `setModel`
  accepts, so it is also the join key to the accepted set. That definition is what lets the
  catalog decorate a runtime set: for each accepted id, look up the entry with that id.
- `source` records where the facts came from. Pi entries are `pi_generated` (regenerated from
  the pi-ai catalog). Claude entries are `curated` (hand-written, though the skill may seed the
  facts from pi-ai's `anthropic` block). One provenance tag per entry is enough because the data
  file an entry lives in is itself single-source (one generated file for Pi, one curated file
  for Claude). Per-field provenance would be ceremony with no reader.
- `pricing` versus `ratings` is the separation the owner called out. `pricing.input_per_mtok`
  is a float dollar amount. `ratings.cost` is an integer 1-5. They are different types with
  different names in different sub-objects. There is no field where a reader could mistake a
  price for a score.
- Everything except `id`, `provider`, and `source` is optional. Claude has no pricing until a
  human curates it. Pi has pricing but no ratings until a human adds them. Optionality is real,
  not cosmetic: an uncurated Pi model is a valid entry with `label`, `description`, and `ratings`
  all absent, and the frontend falls back to `name`, then `id`.

### The `advertised` flag and the Fable case

`advertised` encodes "accepted even if not surfaced by default." An entry with
`advertised: false` is a real, curated model that the live harness may accept, but that Agenta
does not put in the default picker list. The frontend filters the offline picker to
`advertised: true`, while still using every entry (advertised or not) as a decoration lookup for
whatever the runtime accepted set contains.

Fable is the motivating case. The Claude Code SDK accepts Fable, but Agenta does not advertise
it. With this flag, the catalog carries a `claude-fable-5` entry with `advertised: false`: a user
whose live harness offers Fable sees it with a proper label and description, and a user reading
the offline picker does not see a model we have not chosen to promote. The gate never changes;
only whether we list it by default does.

## Worked examples

### A Pi model (auto-generated from the pi-ai catalog)

```json
{
  "id": "openai-codex/gpt-5.3-codex-spark",
  "provider": "openai-codex",
  "source": "pi_generated",
  "name": "GPT-5.3 Codex Spark",
  "pricing": {
    "input_per_mtok": 1.75,
    "output_per_mtok": 14.0,
    "cache_read_per_mtok": 0.175,
    "cache_write_per_mtok": 0.0,
    "currency": "USD"
  },
  "context_window": 128000,
  "modalities": ["text"],
  "label": null,
  "description": null,
  "ratings": null,
  "advertised": true
}
```

Every field above the curated block is copied straight from the pinned pi-ai catalog by the
skill. The curated block is empty until a human adds a description or ratings; the frontend shows
`name` in the meantime.

### A Claude model, advertised (curated, facts seeded from the pi-ai anthropic block)

```json
{
  "id": "opus[1m]",
  "provider": "anthropic",
  "source": "curated",
  "name": "Claude Opus 4.8",
  "pricing": {
    "input_per_mtok": 15.0,
    "output_per_mtok": 75.0,
    "currency": "USD"
  },
  "context_window": 1000000,
  "modalities": ["text", "image"],
  "label": "Opus (1M context)",
  "description": "Strongest reasoning. Use for hard, multi-step work where quality beats cost.",
  "ratings": { "cost": 1, "intelligence": 5, "speed": 2 },
  "advertised": true
}
```

The `id` is the alias the Claude harness accepts, not a vendor model string. `name`, `pricing`,
and `context_window` are seeded from pi-ai's `anthropic` block (which carries `claude-opus-4-8`),
then reviewed by a human. `label`, `description`, and `ratings` are the human's contribution.

### A Claude model, accepted but not advertised (the Fable case)

```json
{
  "id": "claude-fable-5",
  "provider": "anthropic",
  "source": "curated",
  "name": "Claude Fable 5",
  "pricing": { "input_per_mtok": 10.0, "output_per_mtok": 50.0, "currency": "USD" },
  "context_window": 1000000,
  "modalities": ["text", "image"],
  "label": "Fable",
  "description": "Creative-writing tuned. Available on request; not shown by default.",
  "ratings": { "cost": 2, "intelligence": 4, "speed": 3 },
  "advertised": false
}
```

The exact `id` the live SDK reports for Fable is confirmed by the skill's probe (`plan.md`); the
value here matches pi-ai's `anthropic` id. `advertised: false` keeps it out of the default list
while still decorating it if the runtime set offers it.

## The ratings scale: 1-5, higher is better

Recommendation: an integer 1-5 on each of three axes, where a higher number is always better.

- Granularity. Cost, intelligence, and speed each need more than three rungs. On intelligence
  alone, haiku, sonnet, opus, and fable already sit at four distinct levels; a 1-3 scale
  collapses meaningful gaps. Five levels hold the models we have with headroom.
- Human consistency. A curator can reliably tell a 2 from a 4. They cannot reliably tell a 7
  from an 8, which rules out 1-10. Five is the widest scale a person can apply consistently by
  hand, which matters because these are hand-maintained.
- Frontend use. A five-segment meter is a familiar idiom, and a coarser scale wastes the widget.
  Future sort and filter ("intelligence at least 4") want more than three buckets to be useful.

Direction. Every axis reads "higher is better," so a fully filled meter always means a strong
model. That forces one deliberate choice: `cost` is cost-efficiency, so 5 means cheapest and 1
means priciest. The alternative (5 means most expensive) would make a full meter mean "bad,"
which no one reads correctly. The field is documented as cost-efficiency for that reason. Whether
to rename it `economy` to make the direction self-evident is a minor open question (`open-questions.md`).

## Extensibility

- A new rating dimension (say `tool_use`) is a new optional field on `ModelRatings`. Old readers
  ignore it; old data omits it. No version bump needed for a purely additive optional field.
- A new fact (say `max_output_tokens`) is a new optional field on the entry. Same story.
- A new harness is a new capability record whose `model_catalog` is built the same way: generated
  if the harness ships a catalog, curated if it does not.
- `schema_version` exists for the changes that are not additive (renaming a field, changing a
  type, changing the `ratings` range). A consumer that reads `schema_version` can refuse or
  adapt. We start at `"1"`.
- The entry deliberately has no `deployment`, `connection_mode`, or `provider_key` field. Those
  belong to the connection layer (`provider-model-auth`, `custom-providers-in-pi`), not to a model
  fact sheet. Keeping the catalog to "what is this model" and off "how do I authenticate to it"
  is what lets this project land without colliding with that layer (`plan.md`).

## Layering and validation against the accepted set

The catalog is decoration; the accepted set is authority. The skill enforces that they agree, but
a disagreement never makes an unaccepted model selectable, because the runtime gate is unchanged.
The skill's drift report (`plan.md`) compares three sets and flags:

- Advertised but not accepted: an id we publish that the live harness rejects (today: `default[1m]`,
  `haiku[1m]`). Action: drop it from the advertised set, or mark `advertised: false`.
- Accepted but not in the catalog: an id the live harness offers that we have no entry for (today:
  Fable, and any model a new Claude Code build adds). Action: add a curated entry.
- In the catalog but no longer accepted: a curated id the live harness dropped. Action: mark it
  deprecated or remove it.

The end state, which `model-config` Part 3 layer 2 already points at, is that the picker's source
of truth becomes the runtime accepted set, decorated by this catalog, with the advertised set as
the offline fallback. This project builds the decoration and the data discipline that end state
needs. It does not require that end state to ship value: even against today's static advertised
set, the catalog replaces raw ids with labels, descriptions, and pricing.
</content>
