# Builtin Evaluators

## Scope

This document captures the planned consolidation of the current builtin
evaluator catalogue into a smaller set of canonical evaluator families.

The current builtin evaluator list contains multiple legacy evaluators that are
really presets or parameterizations of a smaller number of evaluator families.

## Canonical Families

The target canonical families are:

- `agent`
- `hook`
- `code`
- `prompt`
- `match`

## Legacy Builtins To Consolidate

### `hook`

Legacy builtin:

- `auto_webhook_test`

Target:

- `hook`

### `code`

Legacy builtin:

- `auto_custom_code_run`

Target:

- `code`

### `prompt`

Legacy builtin:

- `auto_ai_critique`

Target:

- `prompt`

Important note:

- this replacement is only correct once prompt-family execution can receive the
  same evaluator context currently injected into `auto_ai_critique`
- today that context includes `inputs`, `outputs`, `trace`, and derived
  `ground_truth` values

### `match`

Legacy builtins:

- `auto_exact_match`
- `auto_regex_test`
- `auto_starts_with`
- `auto_ends_with`
- `auto_contains`
- `auto_contains_any`
- `auto_contains_all`
- `auto_similarity_match`
- `auto_semantic_similarity`
- `auto_levenshtein_distance`
- `field_match_test`
- `json_multi_field_match`
- `auto_contains_json`
- `auto_json_diff`

Target:

- `match`

This family replaces both text-style and JSON-style legacy evaluators.

## Parameter Direction

### `match`

Current direction:

- matching is defined by a recursive matcher tree
- the top-level shape is `matchers: []`
- each matcher node computes its own `success`, `score`, and optional `notes`
- parent/group nodes aggregate child matcher results
- if only one top-level matcher is defined, the result is effectively flat
- text and JSON are not separate evaluator families anymore
- each matcher node declares whether it operates on text or JSON
- the canonical URI family is `agenta:builtin:match:v0`

### `schemas.parameters`

The matcher contract must be explicit in `schemas.parameters`.

At the top level:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "matchers": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/matcher"
      }
    }
  },
  "required": ["matchers"],
  "$defs": {
    "matcher": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "description": "Stable key for this matcher node. Used to identify the corresponding result node."
        },
        "path": {
          "type": "string",
          "description": "Selector path rooted from the top-level evaluation request object. Default syntax is JSONPath."
        },
        "reference": {
          "type": "string",
          "description": "Second operand. If it is a valid JSONPath, resolve it from the request; otherwise treat it as a literal value. For mode=\"regex\", the literal value must be a valid regex."
        },
        "references": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "kind": {
          "type": "string",
          "enum": ["text", "json"]
        },
        "mode": {
          "type": "string",
          "enum": [
            "valid",
            "exact",
            "regex",
            "similarity",
            "starts_with",
            "ends_with",
            "contains",
            "overlap"
          ]
        },
        "match": {
          "type": "string",
          "enum": ["all", "any"]
        },
        "aggregate": {
          "type": "string",
          "enum": ["all", "any", "weighted"]
        },
        "weight": {
          "type": "number"
        },
        "case_sensitive": {
          "type": "boolean"
        },
        "distance": {
          "type": "string",
          "enum": ["cosine", "jaccard", "levenshtein"]
        },
        "threshold": {
          "type": "number"
        },
        "use_schema_only": {
          "type": "boolean"
        },
        "include_unexpected_keys": {
          "type": "boolean"
        },
        "matchers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/matcher"
          }
        }
      },
      "required": ["key", "path", "kind", "mode"],
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

Exhaustive matcher fields:

- `key`
  - required stable key for the matcher node
  - identifies the corresponding result node
- `path`
  - required selector path
  - rooted from the top-level evaluation request object
  - examples:
    - `$.outputs.answer`
    - `$.outputs`
- `reference`
  - comparison/reference operand
  - if it parses as a valid JSONPath, load the value from the request object
  - otherwise treat it as a literal value
- `references`
  - multi-value comparison operand
  - each item follows the same path-or-literal rule as `reference`
- `kind`
  - `text`
  - `json`
- `mode`
  - `valid`
  - `exact`
  - `regex`
  - `similarity`
  - `starts_with`
  - `ends_with`
  - `contains`
  - `overlap`
- `match`
  - used when `references` is present
  - `all`
  - `any`
- `aggregate`
  - aggregation strategy for child matchers
  - `all`
  - `any`
  - `weighted`
- `weight`
  - optional weight used when aggregation is weighted
  - defaults to `1`
- `case_sensitive`
  - optional case-sensitivity switch
  - most relevant for text `regex`
  - also applicable to text `similarity`
- `distance`
  - used by `mode="similarity"`
  - `cosine`
  - `jaccard`
  - `levenshtein`
- `threshold`
  - score threshold for success-producing modes
- `use_schema_only`
  - overlap-specific setting
  - when `true`, compare flattened JSON entries by path and value type only
  - when `false`, compare flattened JSON entries by path and value
- `include_unexpected_keys`
  - overlap-specific setting
  - when `false`, only ground-truth keys are scored
  - when `true`, predicted-only keys are also added to the scoring set
- `matchers`
  - optional recursive child matcher list

### Operand Usage By Mode

The matcher fields are not all used by every mode.

| Mode | Uses `path` | Uses `reference` | Uses `references` | Uses `distance` | Uses `threshold` | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `valid` | yes | no | no | no | no | Validates that the value at `path` conforms to the matcher `kind`. |
| `exact` | yes | yes | no | no | no | Direct literal/path equality. Can also use `case_sensitive`. |
| `regex` | yes | yes | no | no | no | `reference` is either a JSONPath selector or a literal regex. Can also use `case_sensitive`. |
| `similarity` | yes | yes | no | yes | yes | `reference` is either a JSONPath selector or a literal value. Can also use `case_sensitive`. |
| `starts_with` | yes | yes | no | no | no | Prefix comparison. Can also use `case_sensitive`. |
| `ends_with` | yes | yes | no | no | no | Suffix comparison. Can also use `case_sensitive`. |
| `contains` | yes | optional | optional | no | no | Single-value contains uses `reference`. Multi-value contains uses `references` with `match=\"all\" | \"any\"`. Can also use `case_sensitive`. |
| `overlap` | yes | yes | no | no | yes | Mainly for JSON-to-JSON comparison. Also uses `use_schema_only`, `include_unexpected_keys`, and optionally `case_sensitive` for key comparison. |

Per-operand rules:

- `path`
  - always selects the actual value under evaluation
  - should normally point into `$.outputs...`
- `reference`
  - used when the matcher needs a second operand
  - if valid JSONPath, resolve from request
  - otherwise treat as a literal value
  - for `mode="regex"`, the literal value must be a valid regex
- `references`
  - used for multi-value containment
  - each entry follows the same path-or-literal rule as `reference`

Direct mode rules:

- exact match
  - first-class mode, not lowered through regex
- starts_with / ends_with
  - first-class modes
- contains
  - first-class mode
  - single-value contains uses `reference`
  - multi-value contains uses `references` with `match="all" | "any"`
- regex
  - only used for actual regex semantics

### Overlap Options

`overlap` is still the least clean mode in the current design. The options
below should be treated as provisional until we settle the exact semantics.

Current candidate options:

- `use_schema_only`
  - likely keep
  - meaningful for JSON overlap
  - compares flattened entries by path and value type only
  - when `false`, overlap compares flattened entries by path and value
- `include_unexpected_keys`
  - likely keep for legacy parity
  - when `false`, score only keys present in the reference JSON
  - when `true`, include predicted-only keys in the scoring set too
- `case_sensitive`
  - likely keep as the generic option instead of a JSON-specific key flag
  - for JSON overlap, applies to flattened object-key comparison
  - `false` means keys are normalized before comparison

Open questions:

- whether `overlap` is the final mode name
- whether any overlap options should be nested under an `options` object instead
  of staying flat on the matcher

Implementation shape:

- the root shape is a list of matchers
- top level and nested levels use the same `matchers` key
- a single top-level matcher is valid
- multiple top-level matchers are valid
- a top-level matcher may operate on:
  - the whole text output
  - the whole JSON output
- child matchers are optional on any matcher node
- when child matchers exist, each child evaluates a sub-value selected from the
  parent context
- the root object is the evaluation request
- paths are rooted under that request object
- typical roots are:
  - `$.inputs`
  - `$.outputs`
  - `$.trace`
- each matcher selects its actual value through `path`
- exact, regex, similarity, starts_with, ends_with, and single-value contains
  all select the comparison/reference value through `reference`
- multi-value contains uses `references`
- each matcher node returns its own result and parent/group nodes aggregate child
  results
- there is no root-level `correct_answer_key`
- comparison target selection is per matcher
- matcher selectors are request-rooted rather than source-specific fields
- default path syntax should be JSONPath
- supported path syntaxes should be:
  - JSONPath
  - dot notation
  - JSON Pointer
- for `reference` specifically:
  - if the string parses as a valid JSONPath, treat it as a selector
  - otherwise treat it as a literal value
  - for `mode="regex"`, the literal value must parse as a valid regex

Minimal root-only examples:

```python
{
    "matchers": [
        {
            "kind": "text",
            "mode": "regex",
            "path": "$.outputs.answer",
            "reference": "^Paris$",
        },
    ],
}
```

```python
{
    "matchers": [
        {
            "kind": "json",
            "mode": "overlap",
            "path": "$.outputs",
            "reference": "$.inputs.correct_answer",
            "use_schema_only": False,
            "include_unexpected_keys": False,
            "case_sensitive": True,
        },
    ],
}
```

Important notes:

- `starts_with`, `ends_with`, and `contains` are first-class matcher modes
- `contains_any` and `contains_all` are expressed with:
  - `mode="contains"`
  - `references=[...]`
  - `match="any" | "all"`
- `field_match_test` becomes a single-path special case
- `json_multi_field_match` becomes a multi-path special case
- `auto_contains_json` becomes the loosest JSON matcher case
- `auto_json_diff` becomes `mode="overlap"`

Example shape:

```python
{
    "matchers": [
        {
            "kind": "json",
            "mode": "overlap",
            "path": "$.outputs",
            "reference": "$.inputs.correct_answer",
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs.name",
                    "reference": "$.inputs.correct_answer.name",
                },
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs.email",
                    "reference": ".*@example.com$",
                },
                {
                    "kind": "text",
                    "mode": "similarity",
                    "path": "$.outputs.summary",
                    "reference": "$.inputs.correct_answer.summary",
                    "distance": "cosine",
                    "threshold": 0.8,
                },
            ],
        },
    ],
}
```

This unifies:

- valid type/shape checking
- single-field anchored matching
- multi-field anchored matching
- regex matching
- similarity matching
- containment checks
- comparison scoring

### Recursive Result Shape

The execution result should mirror the matcher tree through a static recursive
schema.

Each node should produce:

- `success`
- `score`
- `error`
- `status`
- `message`
- child results when nested matchers exist

This allows:

- leaf matcher truth to be preserved
- parent aggregation to remain explicit
- higher layers to reuse child `success` / `score` / `status` / `message`

### `schemas.outputs`

`schemas.outputs` can stay static while still matching recursive matcher
composition by using one recursive result-node schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/result"
      }
    }
  },
  "required": ["results"],
  "$defs": {
    "result": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "description": "Matcher key copied onto the result node."
        },
        "path": {
          "type": "string",
          "description": "Matcher outputs path copied onto the result node."
        },
        "success": {
          "type": "boolean"
        },
        "score": {
          "type": "number"
        },
        "error": {
          "type": "boolean"
        },
        "status": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/result"
          }
        }
      },
      "required": ["key", "success", "score", "error", "status"],
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

Important point:

- the schema is static
- recursion happens through `children`
- matcher composition determines the runtime shape of the result tree
- no dynamic result-path mechanism is required

### Compare Settings

Current `auto_json_diff` behavior is not a patch-style diff. It is a scored
comparison over flattened JSON fields.

The existing settings are:

- `use_schema_only`
- `include_unexpected_keys`
- `case_sensitive`

So in the canonical matcher family, those settings belong to
`mode="overlap"` rather than to generic regex/similarity matching.

## Current Implementation Differences

Today the three similarity evaluators are not just aliases:

- `auto_similarity_match`
  - Jaccard-style similarity
- `auto_semantic_similarity`
  - embedding/semantic similarity
- `auto_levenshtein_distance`
  - edit-distance comparison

So if they collapse into `match(mode="similarity")`, the differentiator
should live in:

- `distance = "cosine" | "jaccard" | "levenshtein"`

## Legacy To `match` Mappings

The mappings below show the `match` settings needed to reproduce each legacy
evaluator.

This section only applies to the legacy evaluators that collapse into
`agenta:builtin:match:v0`.

These legacy evaluators do not map to `match`:

- `auto_webhook_test`
  - maps to `hook`
- `auto_custom_code_run`
  - maps to `code`
- `auto_ai_critique`
  - maps to `prompt`

Unless otherwise noted:

- the root request object is assumed to contain `$.inputs`, `$.outputs`, and
  `$.trace`
- text outputs use `path = "$.outputs"`
- reference answers use `reference = "$.inputs.correct_answer"`
- exact matching uses `mode="exact"`

### `auto_exact_match`

Legacy behavior:

- strings: exact equality
- dicts: equality after JSON serialization with sorted keys
- success only

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "exact_match",
      "kind": "text",
      "mode": "exact",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer"
    }
  ]
}
```

JSON-typed variant when the output is already treated as JSON:

```json
{
  "matchers": [
    {
      "key": "exact_match_json",
      "kind": "json",
      "mode": "overlap",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "threshold": 1.0
    }
  ]
}
```

### `auto_regex_test`

Legacy behavior:

- applies regex search to the output string
- can be case-sensitive or case-insensitive
- can succeed on match or on mismatch

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "regex_test",
      "kind": "text",
      "mode": "regex",
      "path": "$.outputs",
      "reference": "YOUR_REGEX",
      "case_sensitive": true
    }
  ]
}
```

Mismatch variant:

- same matcher
- invert success at the preset/wrapper level

### `auto_starts_with`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "starts_with",
      "kind": "text",
      "mode": "starts_with",
      "path": "$.outputs",
      "reference": "PREFIX",
      "case_sensitive": true
    }
  ]
}
```

### `auto_ends_with`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "ends_with",
      "kind": "text",
      "mode": "ends_with",
      "path": "$.outputs",
      "reference": "SUFFIX",
      "case_sensitive": true
    }
  ]
}
```

### `auto_contains`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "contains",
      "kind": "text",
      "mode": "contains",
      "path": "$.outputs",
      "reference": "SUBSTRING",
      "case_sensitive": true
    }
  ]
}
```

### `auto_contains_any`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "contains_any",
      "kind": "text",
      "mode": "contains",
      "path": "$.outputs",
      "references": ["OPTION1", "OPTION2", "OPTION3"],
      "match": "any",
      "case_sensitive": true
    }
  ]
}
```

### `auto_contains_all`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "contains_all",
      "kind": "text",
      "mode": "contains",
      "path": "$.outputs",
      "references": ["SUBSTRING1", "SUBSTRING2", "SUBSTRING3"],
      "match": "all",
      "case_sensitive": true
    }
  ]
}
```

### `auto_similarity_match`

Legacy behavior:

- uses `SequenceMatcher(...).ratio()`
- threshold comes from `threshold` or `similarity_threshold`
- optional `case_sensitive`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "similarity_match",
      "kind": "text",
      "mode": "similarity",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "distance": "jaccard",
      "threshold": 0.5,
      "case_sensitive": true
    }
  ]
}
```

Important note:

- this is the intended canonical consolidation
- current implementation is not actually Jaccard; it uses `SequenceMatcher`

### `auto_semantic_similarity`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "semantic_similarity",
      "kind": "text",
      "mode": "similarity",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "distance": "cosine",
      "threshold": 0.5
    }
  ]
}
```

### `auto_levenshtein_distance`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "levenshtein_distance",
      "kind": "text",
      "mode": "similarity",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "distance": "levenshtein",
      "threshold": 0.5,
      "case_sensitive": true
    }
  ]
}
```

### `field_match_test`

Legacy behavior:

- output must parse as JSON object
- compares one top-level field against the testcase value
- success only

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "field_match",
      "kind": "text",
      "mode": "exact",
      "path": "$.outputs.FIELD",
      "reference": "$.inputs.correct_answer"
    }
  ]
}
```

### `json_multi_field_match`

Legacy behavior:

- output must parse as JSON object
- each configured path is compared exactly
- returns one score per field plus `aggregate_score`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "json_multi_field_match",
      "kind": "json",
      "mode": "overlap",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "aggregate": "weighted",
      "matchers": [
        {
          "key": "name",
          "kind": "text",
          "mode": "exact",
          "path": "$.outputs.name",
          "reference": "$.inputs.correct_answer.name"
        },
        {
          "key": "email",
          "kind": "text",
          "mode": "exact",
          "path": "$.outputs.email",
          "reference": "$.inputs.correct_answer.email"
        }
      ]
    }
  ]
}
```

### `auto_contains_json`

Legacy behavior:

- converts the output to text
- extracts the substring between the first `{` and the last `}`
- succeeds if that substring parses as JSON

Strict `match` equivalent when the output itself is already JSON:

```json
{
  "matchers": [
    {
      "key": "contains_json",
      "kind": "json",
      "mode": "valid",
      "path": "$.outputs"
    }
  ]
}
```

Compatibility note:

- the legacy "embedded JSON inside a larger text blob" behavior is not captured
  by the current `match` kernel alone
- reproducing it exactly would require a pre-extraction step before
  `mode="valid"`

### `auto_json_diff`

Legacy behavior:

- flattens both JSON objects
- scores each flattened key as `1.0` or `0.0`
- returns the average score
- optional `use_schema_only`
- optional `include_unexpected_keys`
- optional `case_sensitive`

Equivalent `match` settings:

```json
{
  "matchers": [
    {
      "key": "json_diff",
      "kind": "json",
      "mode": "overlap",
      "path": "$.outputs",
      "reference": "$.inputs.correct_answer",
      "threshold": 0.5,
      "use_schema_only": false,
      "include_unexpected_keys": false,
      "case_sensitive": true
    }
  ]
}
```

## Current UI List

The current frontend does not expose the full backend builtin evaluator set.
The actual UI whitelist is smaller and currently includes:

- `auto_exact_match`
- `auto_contains_json`
- `auto_similarity_match`
- `auto_semantic_similarity`
- `auto_regex_test`
- `field_match_test`
- `json_multi_field_match`
- `auto_json_diff`
- `auto_ai_critique`
- `auto_custom_code_run`
- `auto_webhook_test`
- `auto_levenshtein_distance`

Source:

- `web/oss/src/components/Evaluators/assets/evaluatorFiltering.ts`

## Appendix: Relation To Unit Test Matchers

The recursive matcher model is conceptually close to matcher systems in Jest
and Vitest:

- exact equality
- partial object matching
- regex matching
- per-field nested assertions

What they do not provide as a first-class model is:

- score computation
- threshold-based success
- similarity metrics such as cosine, jaccard, and levenshtein
- recursive result trees with `score` and `notes`
- serializable matcher configs stored as runtime data

So the target `match` workflow should be thought of as:

- matcher-composition ergonomics similar to Jest/Vitest
- but evaluation-oriented rather than assertion-oriented
