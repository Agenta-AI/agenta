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
| `test_run` | 7,777 | 7,593 | 163 | handler-gated; write |
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
3. **`test_run` may not be live.** It is handler-based (`handler="tools.agenta.test_run"`, no
   `method`/`path`) and gated by `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, default off
   (`sdks/python/agenta/sdk/agents/platform/platform_tools.py:36`). With handlers off the live
   advertised cost is **10,576**, of which `commit_revision` alone is 65%.

## Consequence for slicing

| lever | est. after | cut from 18,353 | risk |
| --- | ---: | ---: | --- |
| Schema diet on `commit_revision` + `test_run` | ~5,500 | ~70% | near-zero (see below) |
| \+ trim `query_spans` filter DSL | ~2,970 | ~84% | low |
| \+ discovery meta-toolset | ~400 | ~98% | **high** — see [security.md](security.md) |

The meta-toolset's *marginal* token win over a completed diet is ~2,600 tokens (~14% of the
original bill). That is the number its risk must be weighed against — not the full 18,353.

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

What is genuinely lost by dieting: the harness's own pre-call JSON-Schema validation of the
argument shape (Pi passes `inputSchema` to `registerTool({parameters})`,
`services/runner/src/extensions/agenta.ts:305`). Malformed configs would surface as a server
error instead of a pre-call harness error. Given the server does not validate the config shape
anyway, this is a small change in *where* the error appears, not whether it is caught.

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

## Open measurement gap — prompt caching

**Nothing in this project has measured whether these tokens are actually billed per turn.** Tool
definitions are a stable prompt prefix, which is exactly what provider prompt caching targets, and
both harnesses (Claude Code, Pi) run their own caching. `grep -ri "cache_control|prompt.cach"` over
`services/runner/src` and `sdks/python/agenta/sdk/agents` returns nothing, so the runner neither
sets nor inspects cache behavior — it is entirely the harness's.

If the schemas are cached, the real cost is "18K once, a fraction thereafter", and the ROI of
everything past the diet drops sharply. **Measure this before committing to the meta-toolset.**
