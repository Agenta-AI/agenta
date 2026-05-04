# Playground — Variables Panel & Autocomplete

**Today (screenshot 1):** workflow revision drawer for LLM-as-a-judge. Right panel shows "Generations" with Inputs/Outputs JSON blocks for the current testcase. There's no separate variables panel listing what's discoverable from the prompt + available from testcase data.

**RFC WP-F3:** the variables panel (right side of playground) shows variables discovered from the prompt + variables available from current testcase or trace context, labeled with source and type.

## Wireframe — variables panel (proposed)

```
┌─────────────────────────────────────┐
│ ≪ Variables                         │
├─────────────────────────────────────┤
│                                     │
│ ▾ Discovered from prompt            │
│   ┌───────────────────────────────┐ │
│   │ {{inputs}}     [obj] testcase │ │ ← required, available
│   │ {{outputs}}    [obj] upstream │ │ ← required, available
│   └───────────────────────────────┘ │
│                                     │
│ ▾ Available (testcase context)      │
│   ┌───────────────────────────────┐ │
│   │ ⌄ inputs              [obj]   │ │
│   │   country             [str]   │ │
│   │   correct_answer      [str]   │ │
│   │   testcase_dedup_id   [str]   │ │
│   │ ⌄ outputs             [obj]   │ │
│   │   countryName         [str]   │ │
│   │   capital             [str]   │ │
│   └───────────────────────────────┘ │
│                                     │
│ ▾ Available (trace context)         │
│   ┌───────────────────────────────┐ │
│   │   trace               [obj]   │ │ ← expand to see span tree
│   └───────────────────────────────┘ │
│                                     │
│ ▾ Available (evaluator)             │
│   ┌───────────────────────────────┐ │
│   │ ⌄ parameters          [obj]   │ │
│   │   correct_answer_key  [str]   │ │
│   │   threshold           [num]   │ │
│   └───────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### Sections

1. **Discovered from prompt** — variables the prompt template references. Each shows whether it's currently resolvable. Required-but-missing renders with a warning chip.

2. **Available (testcase context)** — top-level keys from the current testcase row. Expandable to show nested structure.

3. **Available (trace context)** — when the playground node is downstream of a workflow run, shows trace data structure (root span attributes).

4. **Available (evaluator)** — for evaluator nodes, shows evaluator's own parameters object.

### Per-row behavior

```
⌄ propertyName    [type-chip]
```

- **Click row:** insert `{{propertyName}}` at cursor in prompt editor
- **Click chevron:** expand to show nested keys (one level at a time)
- **Hover:** tooltip with current value preview
- **Right-click:** "Copy as `{{$.path.to.value}}`" / "Copy as `{{propertyName}}`" / "Copy current value"

### Empty states

- No prompt loaded yet: section 1 hidden
- No testcase selected: section 2 shows "Select or create a testcase to see available variables"
- No upstream node connected: section 3 hidden
- Not an evaluator: section 4 hidden

## Autocomplete in prompt editor

**Today (already shipped this session):** typeahead works for `{{$.}}` (JSONPath) and `{{flat}}` (curly). Suggests envelope slots at depth 0, port keys + testcase keys at depth 1, sub-keys at depth 2.

**RFC WP-F3:** top-level autocomplete is the MVP; nested completion is a nice-to-have.

### Wireframe — autocomplete popup

```
Prompt editor:
"Capital of {{co│}}"
                ↓ popup at cursor:
                ┌────────────────────────┐
                │ country     [str] inp  │
                │ correct_…   [str] inp  │
                │ countryName [str] out  │
                └────────────────────────┘
```

Each suggestion row:
- Variable name (truncated if long)
- Type chip
- Source short tag

### Source short tags

| Tag | Meaning |
|---|---|
| `inp` | Discovered from `inputs` envelope |
| `out` | Discovered from `outputs` envelope |
| `tc` | Direct testcase column key |
| `param` | Evaluator parameter |
| `trace` | Trace context (online) |
| `seen` | Previously-seen token (fallback) |

## Cross-references

- Source impl: `web/oss/src/components/Playground/PlaygroundTokenPath/` (current typeahead)
- Source impl: `web/packages/agenta-ui/src/editor/plugins/token/TokenTypeaheadPlugin.tsx` (plugin)
- Chain context (per-node scoping): `chainContext.ts` (this session)

## Open questions for team

1. **Variables panel position:** right side of the playground (existing convention) or left side near the prompt? Convention says right.
2. **Insert syntax on click:** `{{name}}` (flat) or `{{$.inputs.name}}` (path)? Default flat per RFC; right-click for path.
3. **Nested autocomplete depth:** stop at depth 2 (current), or pursue full nested? RFC says *"degraded with top-level only is acceptable; full nested is welcome."* MVP: keep current depth-2 behavior.
