# Embeds — Supported Forms & Examples

This document enumerates every embed form covered by the test suite, grouped by category.
Each example shows the exact structure used and which tests exercise it.

---

## Object Embeds

Object embeds replace a config key with the resolved entity data.
The key holds a dict with `@ag.embed` at the top level.

### Without selector — full entity data inlined

```json
{
  "llm_config": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision": { "version": "v1" }
      }
    }
  }
}
```

The value at `llm_config` is replaced with the entire resolved entity dict.

Tests: `test_simple_object_embed` (service), `test_resolve_simple_object_embed` (utils)

---

### With `path` selector — extract a subtree

```json
{
  "system_prompt": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision": { "slug": "my-workflow", "version": "v1" }
      },
      "@ag.selector": { "path": "parameters.system_prompt" }
    }
  }
}
```

`path` is a dot-notation expression. The value at that path inside the resolved entity
replaces the embed key. Raises `PathExtractionError` if the path does not exist.

Tests: `test_object_embed_with_selector` (service), `test_resolve_object_embed_with_selector` (utils),
`test_resolve_workflow_with_simple_embed` (e2e)

---

### All four entity families

Each entity family resolves through its own service.

```json
{
  "workflow":     { "@ag.embed": { "@ag.references": { "workflow_revision":     { "version": "v1"     } } } },
  "environment":  { "@ag.embed": { "@ag.references": { "environment_revision":  { "slug":    "prod"   } } } },
  "application":  { "@ag.embed": { "@ag.references": { "application_revision":  { "version": "latest" } } } },
  "evaluator":    { "@ag.embed": { "@ag.references": { "evaluator_revision":    { "id":      "<uuid>" } } } }
}
```

Tests: `test_all_entity_types` (service) — 4 embeds in the same config

---

### Multiple embeds in same config

```json
{
  "embed1": { "@ag.embed": { "@ag.references": { "workflow_revision":    { "version": "v1"     } } } },
  "embed2": { "@ag.embed": { "@ag.references": { "application_revision": { "version": "latest" } } } }
}
```

Each embed is resolved independently. All are resolved before the config is returned.

Tests: `test_multiple_object_embeds` (service), `test_max_embeds_limit` (e2e — 5 embeds)

---

### Nested embeds — embed resolves to config containing another embed

Input config (depth 0):

```json
{
  "outer": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid-A>" } }
    }
  }
}
```

Revision A returns (depth 1):

```json
{
  "inner": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid-B>" } }
    }
  }
}
```

Revision B returns (depth 2):

```json
{ "value": "final" }
```

Final resolved config:

```json
{ "outer": { "inner": { "value": "final" } } }
```

Nesting is resolved iteratively per depth level. Raises `MaxDepthExceededError` when
`depth_reached` exceeds `max_depth`.

Tests: `test_resolve_nested_embeds` (utils), `test_nested_embeds` (service),
`test_resolve_nested_workflow_embeds` (e2e — 3 levels)

---

### Same entity referenced multiple times

Two embed keys pointing at the same revision slug resolve independently.
The resolver is called once per embed (not deduplicated).

```json
{
  "config_a": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "shared-workflow", "version": "v1" } }
    }
  },
  "config_b": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "shared-workflow", "version": "v1" } }
    }
  }
}
```

Tests: `test_resolve_multiple_embeds_same_workflow` (e2e)

---

### Archived entity handling

By default, embed resolution includes archived entities (`include_archived=True`).

```json
{
  "config": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision": { "slug": "archived-workflow", "version": "v1" }
      }
    }
  }
}
```

The revision pointed to may be archived. The resolver always passes `include_archived=True`
so archived data is still reachable through embeds.

Tests: `test_resolve_excludes_archived_by_default`, `test_resolve_includes_archived_with_flag` (e2e security)

---

## String Embeds

String embeds are inline tokens inside a string value.
The token is replaced in-place; the surrounding text is preserved.

Token grammar:
```
@ag.embed[@ag.references[<entity_type>.<field>=<value>], @ag.selector[<type>=<value>]]
```

---

### Simple — version-based reference, no selector

```json
{ "greeting": "Say: @ag.embed[@ag.references[workflow_revision.version=v1]]" }
```

Without a selector the entire resolved entity is serialised to JSON and inlined.

Tests: `test_resolve_string_embed` (utils), `test_simple_string_embed` (service — with selector),
`test_resolve_string_embed_without_selector` (e2e)

---

### With `path` selector

```json
{
  "prompt": "System: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path=parameters.system_prompt]]"
}
```

`path=` extracts a scalar or subtree from the resolved entity and converts it to a string.

Tests: `test_simple_string_embed` (service), `test_resolve_simple_string_embed` (e2e)

---

### With variant `id` reference and `path` selector

```json
{
  "message": "Content: @ag.embed[@ag.references[workflow_variant.id=<uuid>], @ag.selector[path=params.message.content]]"
}
```

The reference field can be `id`, `slug`, or `version`. UUID values are parsed directly.

Tests: `test_find_string_embed_with_selector` (utils)

---

### With `key` selector — two-hop resolution

```json
{
  "auth": "@ag.embed[@ag.references[environment_revision.id=<uuid>], @ag.selector[key=api_config]]"
}
```

`key=` performs a two-hop resolution:
1. Fetch the environment revision.
2. Follow `data.references.<key>` — which is itself a `Reference` pointer.
3. Fetch that secondary entity.
4. Apply `path` if also present; otherwise inline the secondary entity.

Tests: `test_find_environment_revision_key_selector` (utils)

---

### Multiple tokens in a single string

```json
{
  "prompt": "Model: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path=parameters.model]] Temp: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path=parameters.temperature]]"
}
```

All tokens in the string are replaced left-to-right before the string is returned.
Each token counts as one resolved embed.

Tests: `test_multiple_string_embeds_in_same_string` (service),
`test_resolve_multiple_string_embeds_in_value` (e2e)

---

### Nested — resolved string contains another string token

Input config (depth 0):

```json
{
  "prompt": "Outer: @ag.embed[@ag.references[workflow_revision.slug=level-1], @ag.selector[path=parameters.text]]"
}
```

`parameters.text` inside revision `level-1` (depth 1):

```json
"Middle: @ag.embed[@ag.references[workflow_revision.slug=level-2], @ag.selector[path=parameters.text]]"
```

`parameters.text` inside revision `level-2` (depth 2):

```json
"Inner: @ag.embed[@ag.references[workflow_revision.slug=level-3], @ag.selector[path=parameters.value]]"
```

Revision `level-3` returns `"final value"`. Final resolved config:

```json
{ "prompt": "Outer: Middle: Inner: final value" }
```

Each depth level is processed in a separate pass.

Tests: `test_resolve_nested_string_embeds` (e2e string — 3 levels)

---

## Multi-Reference Embeds

Multiple entries inside a single `@ag.references` block.

### Same entity family — variant + revision (valid)

```json
{
  "combined": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_variant":  { "id": "<uuid>" },
        "workflow_revision": { "version": "v1" }
      }
    }
  }
}
```

All references must belong to the same entity family (`workflow`, `environment`, etc.).
They are passed together as a single dict to the resolver in one call.
The variant ref acts as a scoping hint; the revision ref is the primary fetch target.

Tests: `test_multiple_references_same_family` (utils)

---

### Mixed families — raises `MixedEntityTypesError`

```json
{
  "bad": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision":    { "version": "v1"   },
        "environment_revision": { "slug":    "prod" }
      }
    }
  }
}
```

Mixing `workflow_*` and `environment_*` (or any two different families) in one embed block
raises `MixedEntityTypesError` before any resolution is attempted.

Tests: `test_mixed_family_references_raises_error` (utils)

---

## Cross-Entity Embeds (e2e)

### Workflow → Environment revision (with `path` selector)

```json
{
  "api_settings": {
    "@ag.embed": {
      "@ag.references": { "environment_revision": { "slug": "prod" } },
      "@ag.selector": { "path": "references.api_settings" }
    }
  }
}
```

### Environment (references-only data — no embed)

An environment revision stores named references to other entities in `data.references`.
No `@ag.embed` is needed; the references block is part of the entity's own schema.

```json
{
  "references": {
    "api_settings": {
      "workflow_revision": { "slug": "my-workflow", "version": "v1" }
    }
  }
}
```

### Workflow A → Environment → Workflow B (two-hop via `key` selector)

```json
{
  "resolved_workflow": {
    "@ag.embed": {
      "@ag.references": { "environment_revision": { "slug": "prod" } },
      "@ag.selector": { "key": "api_settings" }
    }
  }
}
```

The environment revision's `data.references.api_settings` is itself a reference to Workflow B,
which is then fetched and inlined.

### Application → Workflow (legacy API)

```json
{
  "workflow_config": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "base-workflow", "version": "v1" } }
    }
  }
}
```

The embed lives inside an application revision's config. Resolution is identical to workflow embeds.

### Evaluator → Workflow

```json
{
  "eval_prompt": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision": { "slug": "prompt-workflow", "version": "v1" }
      },
      "@ag.selector": { "path": "parameters.system_prompt" }
    }
  }
}
```

| Chain | Description |
|-------|-------------|
| Workflow → Environment revision | `environment_revision` embed; `path` drills into `references.api_settings` |
| Workflow → Environment (references-only) | Environment's `data.references` stores workflow refs; no embed directive |
| Workflow A → Environment → Workflow B | Two-hop: env holds a ref to a second workflow via `key` selector |
| Application → Workflow | Legacy app config embeds `workflow_revision` |
| Evaluator → Workflow | Evaluator config embeds `workflow_revision` |
| Workflow → Evaluator | Reverse direction |
| Evaluator → Application | Cross-entity in the other direction |

---

## Mixed-Form Chains (e2e string tests)

### Object → String

The outer key holds an object embed. The resolved entity's data contains a string value
with an inline `@ag.embed` token, which is resolved in the next pass.

Input config:

```json
{
  "outer": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "level-1", "version": "v1" } }
    }
  }
}
```

Resolved entity data (contains a string embed):

```json
{
  "parameters": {
    "final_msg": "Hello: @ag.embed[@ag.references[workflow_revision.slug=level-2], @ag.selector[path=parameters.value]]"
  }
}
```

### String → Object

The outer value is a string containing an `@ag.embed` token. The token resolves to entity data
that contains object embed dicts, which are resolved in the next pass.

Input config:

```json
{
  "setting": "@ag.embed[@ag.references[workflow_revision.slug=level-1], @ag.selector[path=parameters.setting]]"
}
```

`parameters.setting` inside the resolved entity (contains an object embed):

```json
{
  "@ag.embed": {
    "@ag.references": { "workflow_revision": { "slug": "level-2", "version": "v1" } }
  }
}
```

### Object → String → Object (3-level)

```json
{
  "outer": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "level-1", "version": "v1" } }
    }
  }
}
```

Level 1 returns a dict with a string value containing another token:

```json
{
  "parameters": {
    "obj_config": "@ag.embed[@ag.references[workflow_revision.slug=level-2], @ag.selector[path=parameters.base]]"
  }
}
```

Level 2 `parameters.base` is itself an object embed:

```json
{
  "@ag.embed": {
    "@ag.references": { "workflow_revision": { "slug": "level-3", "version": "v1" } }
  }
}
```

| Chain | Description |
|-------|-------------|
| Object → String | Object embed resolves to a dict that contains string embed tokens |
| String → Object | String token resolves to data that contains object embed dicts |
| Object → String → Object | 3-level: object embed → string token inside → object embed inside that |

---

## Error & Limit Cases

### Circular self-reference

Revision A points back to itself. Detected at the second iteration.

```json
{
  "data": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid-A>" } }
    }
  }
}
```

Revision A's data (returned by the resolver):

```json
{
  "self_ref": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid-A>" } }
    }
  }
}
```

Raises `CircularEmbedError`.

### Circular chain (A → B → A)

```json
{
  "start": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid-A>" } }
    }
  }
}
```

Revision A returns an embed for B; revision B returns an embed for A again.
Raises `CircularEmbedError` at the point where A is seen a second time.

### `MaxDepthExceededError`

Each resolved entity returns another embed, so depth keeps growing.

```json
{
  "embed": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "id": "<uuid>" } }
    }
  }
}
```

Resolver always returns another embed with a new UUID. With `max_depth=3`, raises after
3 iterations.

### `MaxEmbedsExceededError`

Too many parallel embeds in a single config.

```json
{
  "embed_0": { "@ag.embed": { "@ag.references": { "workflow_revision": { "id": "<uuid-0>" } } } },
  "embed_1": { "@ag.embed": { "@ag.references": { "workflow_revision": { "id": "<uuid-1>" } } } },
  "embed_2": { "@ag.embed": { "@ag.references": { "workflow_revision": { "id": "<uuid-2>" } } } },
  "embed_3": { "@ag.embed": { "@ag.references": { "workflow_revision": { "id": "<uuid-3>" } } } },
  "embed_4": { "@ag.embed": { "@ag.references": { "workflow_revision": { "id": "<uuid-4>" } } } }
}
```

With `max_embeds=2`, raises before any resolution begins.

### `PathExtractionError`

The resolved entity does not have the path specified in the selector.

```json
{
  "config": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "version": "v1" } },
      "@ag.selector": { "path": "parameters.missing.nested.key" }
    }
  }
}
```

Raised during path extraction after the entity is fetched.

### Error policies

All three policies apply to the same config shape — only the call option differs:

```json
{
  "config": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "version": "missing" } }
    }
  }
}
```

| Policy | Result |
|--------|--------|
| `ErrorPolicy.EXCEPTION` | Exception re-raised to caller |
| `ErrorPolicy.PLACEHOLDER` | `"config"` → `"<error: Entity not found>"` |
| `ErrorPolicy.KEEP` | `"config"` keeps its `@ag.embed` dict unchanged |

| Error / Limit | Trigger | Behaviour |
|---------------|---------|-----------|
| `CircularEmbedError` | A revision references itself | Raised immediately |
| `CircularEmbedError` (chain) | A → B → A | Detected at iteration boundary |
| `MaxDepthExceededError` | `depth_reached > max_depth` (tested at limits 1 and 3) | Raised before next iteration |
| `MaxEmbedsExceededError` | `embeds_resolved > max_embeds` (tested at limits 2 and 5) | Raised before resolution begins |
| `PathExtractionError` | `selector.path` does not exist in resolved data | Raised during path extraction |
| `ErrorPolicy.EXCEPTION` | Resolver raises | Re-raises to caller |
| `ErrorPolicy.PLACEHOLDER` | Resolver raises | Replaces embed with `<error:…>` string |
| `ErrorPolicy.KEEP` | Resolver raises | Leaves `@ag.embed` structure intact |

---

## Retrieve / Query Endpoints with `resolve=True` (e2e)

### `GET /revisions/retrieve?resolve=true` — pre-resolved response

Stored revision data (raw):

```json
{
  "config": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "base", "version": "v1" } },
      "@ag.selector": { "path": "parameters.greeting" }
    }
  }
}
```

Response with `resolve=true`:

```json
{
  "config": "Hello, World!"
}
```

### `GET /revisions/retrieve` (no flag) — markers preserved

Response without `resolve`:

```json
{
  "config": {
    "@ag.embed": {
      "@ag.references": { "workflow_revision": { "slug": "base", "version": "v1" } },
      "@ag.selector": { "path": "parameters.greeting" }
    }
  }
}
```

### `POST /revisions/query?resolve=true` — resolves all returned revisions

All revisions in the result set have their embeds resolved before the response is returned.

### `GET /revisions/retrieve?resolve=true` (no embeds present)

When the stored config contains no `@ag.embed` keys, the response is identical to the
unresolved response.

| Endpoint | Behaviour |
|----------|-----------|
| `GET /revisions/retrieve?resolve=true` | Returns pre-resolved revision data |
| `GET /revisions/retrieve` (no flag) | Returns raw config with `@ag.embed` markers intact |
| `POST /revisions/query?resolve=true` | Resolves embeds in all returned revisions |
| `GET /applications/revisions/retrieve?resolve=true` | Same for application revisions |
| `GET /evaluators/revisions/retrieve?resolve=true` | Same for evaluator revisions |
| `GET /revisions/retrieve?resolve=true` (no embeds) | Returns config unchanged |
