---
name: update-llm-model-list
description: Audit and update the supported LLM model list in assets.py against litellm's registry (models.litellm.ai). Use when adding new models, pruning outdated ones, or verifying the list is correct.
---

# Update LLM Model List

## Overview

The canonical model list lives in `sdk/agenta/sdk/assets.py` → `supported_llm_models`.
It drives the model dropdown in the playground, cost metadata, and the `model_to_provider_mapping`.

The authoritative external source is **`litellm.model_cost`** (2 600+ entries), which mirrors
<https://models.litellm.ai/>.

A pytest guard lives at:
`sdk/oss/tests/pytest/unit/test_supported_llm_models.py`

---

## Key rules

1. **Every model must exist in `litellm.model_cost`** (direct key, or with provider prefix stripped).
   - `anthropic/claude-*` → litellm stores as `claude-*` (prefix is intentional for routing, stripped for cost lookup)
   - `cohere/command-*` → litellm stores as `command-*`
   - All other providers keep their full prefix (e.g. `gemini/`, `groq/`, `together_ai/`)
2. **Provider key** (`"anthropic"`, `"gemini"`, …) must match the Secrets API enum in
   `api/oss/src/core/secrets/enums.py` (`StandardProviderKind`).
3. **No duplicates** within a provider list.

---

## Step 1 — Check which current models are outdated / wrong

Run this with `uvx` (no local install needed):

```bash
cat > /tmp/check_agenta_models.py << 'SCRIPT'
# /// script
# requires-python = ">=3.11"
# dependencies = ["litellm"]
# ///
import litellm, sys

# paste supported_llm_models here or import it
from agenta.sdk.assets import supported_llm_models

mc = set(litellm.model_cost.keys())

def exists(m):
    if m in mc: return True
    if "/" in m and m.split("/", 1)[1] in mc: return True
    return False

fails = []
for provider, models in supported_llm_models.items():
    for model in models:
        if not exists(model):
            fails.append((provider, model))

total = sum(len(v) for v in supported_llm_models.values())
print(f"Total models checked: {total}")
if fails:
    for p, m in fails:
        print(f"  MISSING [{p}] {m}")
    sys.exit(1)
else:
    print("All models valid ✓")
SCRIPT
uvx --with litellm python /tmp/check_agenta_models.py 2>/dev/null
```

Alternatively, run the pytest unit test directly (requires agenta installed):

```bash
pytest sdk/oss/tests/pytest/unit/test_supported_llm_models.py -v
```

---

## Step 2 — Find models missing from Agenta (big-3 audit)

This script finds models in litellm that Agenta doesn't list yet, filtered to remove
noise (audio, video, embeddings, codex, snapshots):

```bash
cat > /tmp/find_missing.py << 'SCRIPT'
# /// script
# requires-python = ">=3.11"
# dependencies = ["litellm"]
# ///
import litellm, re

AGENTA_ANTHROPIC = set()   # fill from assets.py (bare names, no prefix)
AGENTA_OPENAI    = set()   # fill from assets.py
AGENTA_GEMINI    = set()   # fill from assets.py (with gemini/ prefix)

mc = set(litellm.model_cost.keys())

NOISE = [
    "audio","tts","speech","whisper","transcri","realtime","diarize",
    "dall-e","image","video","veo","embed","moderat","search",
    "babbage","davinci","ada","instruct","codex","computer-use",
    "robotics","learnlm","gemma","live","v1:0",
]
KEEP = {"gpt-4o","gpt-4o-mini"}
DATED = re.compile(r"-\d{4}-\d{2}-\d{2}$")
EXP   = re.compile(r"exp-\d{4}|\d{2}-\d{2}$")

def noise(m):
    if m in KEEP: return False
    return any(kw in m.lower() for kw in NOISE)

def dated(m):
    return bool(DATED.search(m)) or bool(EXP.search(m))

def report(label, candidates, known, prefix=""):
    print(f"\n=== {label} ===")
    for m in sorted(candidates):
        bare = m[len(prefix):] if prefix else m
        if bare in known or m in known: continue
        tag = "[dated/exp]" if dated(m) else "[alias]" if m.endswith("-latest") else "*** MISSING ***"
        print(f"  {m}  {tag}")

# Anthropic
report("ANTHROPIC", [m for m in mc if m.startswith("claude-") and not noise(m)],
       AGENTA_ANTHROPIC)

# OpenAI (no slash, starts with gpt- / o1 / o3 / o4)
OAI = [m for m in mc if any(m.startswith(p) for p in ("gpt-","o1","o3","o4","chatgpt"))
       and "/" not in m and not noise(m)]
report("OPENAI", OAI, AGENTA_OPENAI)

# Gemini
report("GEMINI", [m for m in mc if m.startswith("gemini/") and not noise(m)],
       AGENTA_GEMINI, prefix="gemini/")
SCRIPT
uvx --with litellm python /tmp/find_missing.py 2>/dev/null
```

**Fill in the `AGENTA_*` sets from the current `assets.py`** before running.

---

## Step 3 — Edit `assets.py`

File: `sdk/agenta/sdk/assets.py`

- Add models inside the correct provider list, newest first.
- For **Gemini 1.5** models (still widely used): add under `"gemini"`.
- For **OpenAI o-series pro tiers** (`o1-pro`, `o3-pro`): add after their base model.
- For **Groq**: always cross-check `litellm.groq_models` — Groq rotates its model catalogue frequently.
- For **DeepInfra / Together AI**: check `litellm.deepinfra_models` / `litellm.together_ai_models` for current names.

### Provider prefix conventions

| Provider key | Agenta prefix | litellm cost key prefix |
|---|---|---|
| `anthropic` | `anthropic/` | `claude-` (no prefix) |
| `cohere` | `cohere/` | `command-` (no prefix) |
| `gemini` | `gemini/` | `gemini/` |
| `groq` | `groq/` | `groq/` |
| `mistral` | `mistral/` | `mistral/` |
| `openai` | _(none)_ | _(none)_ |
| `openrouter` | `openrouter/` | `openrouter/` |
| `perplexityai` | `perplexity/` | `perplexity/` |
| `together_ai` | `together_ai/` | `together_ai/` |
| `deepinfra` | `deepinfra/` | `deepinfra/` |

---

## Step 4 — Run ruff then the test

```bash
# Format + lint
uvx --from ruff==0.14.0 ruff format sdk/agenta/sdk/assets.py
uvx --from ruff==0.14.0 ruff check --fix sdk/agenta/sdk/assets.py

# Validate all models against litellm (no agenta install needed)
uvx --with litellm python /tmp/check_agenta_models.py 2>/dev/null
```

All checks must pass before committing.

---

## Related files

| File | Purpose |
|---|---|
| `sdk/agenta/sdk/assets.py` | Canonical model list + cost metadata builder |
| `sdk/oss/tests/pytest/unit/test_supported_llm_models.py` | Pytest guard (parametrized per model) |
| `api/oss/src/core/secrets/enums.py` | Provider keys — must stay in sync |
| `api/oss/src/resources/evaluators/evaluators.py` | Separate (shorter) model list for evaluator dropdown |
