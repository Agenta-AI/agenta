# Runnable URI Inclusion

## Scope

This document is intentionally separate from `catalog.md`.

`catalog.md` defines:

- route shape
- request/response models
- template vs preset structure

This document only defines the runnable URI structure and the kinds of
classification we want to derive from it.

## URI Structure

A runnable URI has four logical parts:

1. source
2. kind
3. key
4. version

For example:

```text
agenta:builtin:auto_ai_critique:v0
user:custom:my-workflow:v3
```

## URI Parts

### Part 1: `source`

The first URI segment identifies where the runnable comes from.

Current expected values:

- `agenta`
- `user`

Meaning:

- `agenta`: platform-provided runnable
- `user`: user-provided runnable

### Part 2: `kind`

The second URI segment identifies the broad origin/type family.

Current expected values:

- `builtin`
- `custom`

Meaning:

- `builtin`: predefined runnable/template shipped by the platform
- `custom`: project or user-defined runnable/template

### Part 3: `key`

The third URI segment is the stable logical key for the runnable.

Examples:

- `auto_ai_critique`
- `chat`
- `completion`
- `my-workflow`

This is not the version. It is the stable identifier of the runnable family.

### Part 4: `version`

The fourth URI segment is the version of that runnable family.

Examples:

- `v0`
- `v1`
- `v3`

This identifies the versioned template family behind the URI.

## Matching Syntax

When we describe URI groups in tables below:

- `*` means "any value"
- `[name]` means "a variable value"

Examples:

- `agenta:builtin:*:v0`
- `user:custom:[key]:[version]`

## URI Classification Matrix

The goal of this matrix is to be exhaustive over meaningful URI patterns and
to state what each pattern implies for runnable classification and catalog
inclusion.

The first row below captures the current built-in evaluator template family.
When a cell needs multiple exact values, they should appear on separate lines
inside the same cell, not collapsed into brackets.

| URI | is_builtin | is_custom | is_application | is_evaluator | is_feedback | is_chat | can_chat | can_stream | can_batch | schemas.inputs | schemas.parameters | schemas.outputs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agenta:builtin:auto_exact_match:v0`<br>`agenta:builtin:auto_contains_json:v0`<br>`agenta:builtin:auto_similarity_match:v0`<br>`agenta:builtin:auto_semantic_similarity:v0`<br>`agenta:builtin:auto_regex_test:v0`<br>`agenta:builtin:field_match_test:v0`<br>`agenta:builtin:json_multi_field_match:v0`<br>`agenta:builtin:auto_json_diff:v0`<br>`agenta:builtin:auto_ai_critique:v0`<br>`agenta:builtin:auto_custom_code_run:v0`<br>`agenta:builtin:auto_webhook_test:v0`<br>`agenta:builtin:auto_levenshtein_distance:v0` | `true` | `false` | `false` | `true` | `false` | `false` | `false` | `false` | `true` | `in-catalog / required` | `in-catalog / required` | `in-catalog / required` |
| `agenta:builtin:chat:v0` | `true` | `false` | `true` | `false` | `false` | `true` | `false` | `true` | `true` | `in-catalog / required` | `in-catalog / required` | `in-catalog / required` |
| `agenta:builtin:completion:v0` | `true` | `false` | `true` | `false` | `false` | `false` | `false` | `false` | `true` | `in-catalog / required` | `in-catalog / required` | `in-catalog / required` |
| `agenta:custom:hook:v0` | `false` | `true` | `true` | `true` | `false` | `false` | `true` | `true` | `true` | `- / recommended` | `- / recommended` | `- / recommended` |
| `agenta:custom:code:v0` | `false` | `true` | `true` | `true` | `false` | `false` | `true` | `true` | `true` | `- / recommended` | `- / recommended` | `- / recommended` |
| `agenta:custom:prompt:v0` | `false` | `true` | `true` | `true` | `false` | `false` | `true` | `true` | `true` | `in-catalog / required` | `in-catalog / required` | `in-catalog / required` |
| `agenta:custom:agent:v0` | `false` | `true` | `true` | `true` | `false` | `false` | `true` | `true` | `true` | `in-catalog / required` | `in-catalog / required` | `in-catalog / required` |
| `agenta:custom:invocation:v0` | `false` | `true` | `true` | `false` | `true` | `false` | `true` | `-` | `-` | `- / recommended` | `- / recommended` | `- / recommended` |
| `agenta:custom:annotation:v0` | `false` | `true` | `false` | `true` | `true` | `false` | `true` | `-` | `-` | `- / recommended` | `- / recommended` | `- / recommended` |
| `user:custom:[handler]:[version]` | `false` | `true` | `true` | `true` | `false` | `false` | `true` | `true` | `true` | `- / recommended` | `- / recommended` | `- / recommended` |
