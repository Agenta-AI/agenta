# Baseline — measured advertised token cost

**Measured 2026-07-26** (tiktoken `o200k_base`) against the live catalog on `main`. This
supersedes the 2026-07-17 numbers that the earlier drafts carried; those were ~19% low because
the catalog grew since.

## Per-op advertised cost

Counts the advertised projection the model actually sees — `{name, description, inputSchema}`,
with `inputSchema` = `PlatformOp.resolved_input_schema()` (type-refs expanded, context bindings
stripped), matching `advertisedToolSpec()` in `services/runner/src/tools/public-spec.ts:40`.

| op | total | schema | descr | note |
| --- | ---: | ---: | ---: | --- |
| `test_run` | 7,777 | 7,593 | 163 | handler-mode (`callRef`), advertised by default; write |
| `commit_revision` | 6,878 | 6,713 | 147 | write |
| `query_spans` | 1,578 | 1,463 | 96 | read |
| `create_schedule` | 425 | 351 | 56 | write |
| `create_subscription` | 393 | 322 | 53 | write |
| `discover_triggers` | 356 | 171 | 165 | read |
| `annotate_trace` | 333 | 208 | 100 | write |
| `discover_tools` | 204 | 124 | 61 | read |
| `test_subscription` | 188 | 134 | 36 | write |
| `remove_schedule` | 69 | 41 | 10 | write |
| `remove_subscription` | 69 | 41 | 10 | write |
| `list_deliveries` | 46 | 11 | 14 | read |
| `list_schedules` | 37 | 11 | 6 | read |
| **total (13 ops)** | **18,353** | | | |

## The three facts that drive the plan

1. **Three ops are 88% of the bill.** `test_run` + `commit_revision` + `query_spans` = 16,233 of
   18,353. The other **ten ops combined are 2,120 tokens** — seven of them under 400 each.
2. **One schema object is 70% of the bill.** `_build_agent_template_delta_schema()`
   (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:317`) is **6,441 tokens** and is embedded
   **twice** — in `commit_revision` and in `test_run`. That is 12,882 of 18,353.
3. **All 13 ops are live by default — 18,353 is the real number.** `test_run` is handler-based
   (`handler="tools.agenta.test_run"`, no `method`/`path`) and gated by
   `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, but that flag **defaults ON**
   (`sdks/python/agenta/sdk/agents/platform/platform_tools.py:41`):

   ```python
   if value is None: return True   # unset -> ENABLED
   return value.strip().lower() not in _DISABLED_ENV_VALUES
   ```

   Unset *and* empty both mean enabled; the resolver skips the op only for an explicit `off` /
   `false` / `0` (`_DISABLED_ENV_VALUES`). The resolver's own log line says "explicitly disabled".

   > **Correction.** Drafts before 2026-07-26 (and the 2026-07-17 investigation they came from)
   > claimed "default off" and carried a 10,576-token alternate figure. That was wrong. There is no
   > alternate figure: `test_run` advertises unless someone opts out, so its 7,777 tokens — 42% of
   > the bill — are real, and Phase 1's win is the full ~12,900.

## Consequence for phasing

| lever | est. after | cut from 18,353 | risk |
| --- | ---: | ---: | --- |
| Schema diet on `commit_revision` + `test_run` | ~5,500 | ~70% | near-zero (see below) |
| \+ trim `query_spans` filter DSL | ~2,970 | ~84% | low |
| \+ lazy schema | ~500 | ~97% | one projection function; no permission change |
| \+ lazy activation | ~400 | ~98% | **out of scope** — per-harness transport work |

Two numbers decide the plan's shape:

- **Lazy schema's marginal win over a completed diet is ~2,500 tokens (~13%)** at the cost of one
  function in `public-spec.ts` — and it is structural: schema growth stops inflating the prompt.
  (The eager discovery index still grows by ~12 tokens per new op.)
- **Lazy activation's marginal win over lazy schema is ~100 tokens**, which is why it is out of
  scope ([alternatives.md](alternatives.md#3--lazy-activation-out-of-scope)). Its case is tool *count*
  (wander), not tokens. Weigh its per-harness transport cost against wander evidence only.

## Why the diet is near-zero risk

The embedded schema is **advisory duplication of a doc that already ships and is already
mandatory reading**:

- `references/config-schema.md` is a 3,621-token prose + example reference, shipped as a
  `SkillFile` on `BUILD_AN_AGENT_SKILL`
  (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:740`).
- The skill body already instructs: *"Read `references/config-schema.md` before your first
  `commit_revision`"* (`agenta_builtins.py:579`), and again on failure (`:711`, `:716`).
- That reference states plainly that **the commit endpoint does not validate this shape**. So the
  embedded JSON Schema is not enforcing a server contract — it is model guidance that a
  better-written, on-demand doc already provides.

**Top-level required-argument checking is not lost.** The runner re-validates against the
**private** spec before executing — `assertRequiredArguments(spec, req.args)` at
`services/runner/src/tools/relay.ts:327` (client shape) and `:369` (endpoint and handler shapes).
What moves is *where* a malformed call is caught: at the relay rather than pre-call in the harness
(Pi passes `inputSchema` to `registerTool({parameters})`,
`services/runner/src/extensions/agenta.ts:305`).

**What the diet does cost:** `missingRequiredFields` recurses through `properties`, so today a deep
schema enforces nested `required` too. The diet edits `op_catalog.py`, which shrinks the *private*
spec as well, so those nested checks go away at every layer. Bounded by the same fact that makes the
diet safe: the commit endpoint does not validate the config shape either. Lazy schema does **not**
have this cost — it stubs only the advertisement and leaves the private spec whole.

## Reproducing

```python
import sys, json, tiktoken
sys.path.insert(0, "sdks/python")
from agenta.sdk.agents.platform.op_catalog import get_platform_op

OPS = ("discover_tools","commit_revision","annotate_trace","query_spans","test_run",
       "discover_triggers","create_schedule","create_subscription","list_schedules",
       "list_deliveries","test_subscription","remove_schedule","remove_subscription")
enc = tiktoken.get_encoding("o200k_base")
total = 0
for name in OPS:
    op = get_platform_op(name)
    adv = {"name": f"tools.agenta.{name}", "description": op.description,
           "inputSchema": op.resolved_input_schema()}
    n = len(enc.encode(json.dumps(adv)))
    total += n
    print(f"{name:22} {n:>7}")
print(f"{'TOTAL':22} {total:>7}")
```
