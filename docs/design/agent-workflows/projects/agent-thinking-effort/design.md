# Technical design

## Author contract

Add an optional reasoning object to the agent's LLM configuration:

```json
{
  "agent": {
    "llm": {
      "model": "openai-codex/gpt-5.5",
      "reasoning": {
        "effort": "high"
      }
    }
  }
}
```

Schema:

```text
ReasoningEffort = default | off | minimal | low | medium | high | xhigh | max
LlmReasoning = { effort?: ReasoningEffort }
```

Omission and `default` have the same author meaning: use Agenta's deterministic model default. The UI stores omission for Model default so existing revisions and default golden payloads remain unchanged.

The union is intentionally broader than any single model. Support is resolved from the selected session after applying the model.

## Legacy compatibility

Resolution order:

1. `agent.llm.reasoning.effort`
2. `agent.llm.extras.reasoning_effort`
3. `default`

Normalize legacy `none` to `off`. Emit a deprecation warning when the legacy path is used. Preserve the original extras object when reading or editing a revision. Do not mutate historical revisions or write a migration on read.

The new field always wins if both are present. A malformed new field fails schema validation even when a valid legacy field exists.

## Wire contract

Add an optional grouped field to `/run`:

```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

The Python serializer omits `reasoning` for default. The Python wire model and TypeScript protocol describe the same literal union. They do not currently provide end-to-end runtime strictness: the Python `_WireModel` allows extra fields, TypeScript types disappear at runtime, and the runner does not validate incoming JSON against a runtime schema.

The runtime DTO parser must validate the first-class literal independently of the catalog schema so direct invocation cannot bypass validation. Runtime rejection of unrelated unknown wire keys is outside this feature's scope unless the implementation deliberately adds a request validator.

Capability negotiation:

- HTTP sidecars expose `features.reasoningEffort: 1` from `GET /health`.
- Subprocess runners expose the same `runnerInfo` payload through a new `--info` command without reading a run request or starting a harness.
- The Python backend caches a successful probe per backend instance.
- An explicit effort fails closed before `/run` when the capability is missing, unknown, timed out, or unreachable.
- Omission/default may continue through an old runner during rollout and retains that runner's legacy no-reset behavior.
- This outer capability proves only that the runner knows the contract. It does not prove that a Daytona image's baked adapter supports a value; that remains runtime pre-prompt discovery.

Propagation:

| Source | Destination | Transformation |
| --- | --- | --- |
| Template `llm.reasoning.effort` | `AgentTemplate.reasoning_effort` | Parse literal; apply legacy fallback. |
| `AgentTemplate` | `HarnessAgentTemplate` | Preserve semantic value for Pi and Claude. |
| Harness adapter | `/run.reasoning.effort` | Omit default, send explicit values. |
| Runner request | ACP session | Apply model, then call `setThoughtLevel`. |
| ACP config options | validation/readback | Require category support and exact adapter-reported value. |

Do not send arbitrary `llm.extras` to the runner. Only the normalized semantic field crosses the trust boundary.

## Runner algorithm

For every cold or native-resume acquisition:

1. Create or resume the ACP session.
2. Apply the requested model.
3. Fetch config options after model selection.
4. Resolve the effort option with category `thought_level`.
5. Apply the normalized requested value or deterministic default.
6. Fetch config options again and verify the adapter-reported `currentValue`.
7. Prompt only after validation succeeds.

Explicit values:

- If no thought-level category exists, return an unsupported-effort error before prompting.
- If the value is not advertised, return the requested value, model, and adapter-advertised values.
- If the adapter accepts but clamps to a different value, fail rather than silently changing author intent.
- Pi ACP 0.0.29 cannot list model-specific allowed values. A Pi clamp error therefore reports requested and adapter-reported values and explains that the adapter exposed no exact per-model list.

Default:

- Pi: request `medium`, its built-in default, to prevent global setting leakage. For default intent only, accept a model clamp and record the adapter-reported value.
- Claude: set `default` when the adapter advertises it.
- A model with no thought-level category: no-op for default only.

The error shape should be stable enough for UI display when exact allowed values are available, for example:

```text
Effort 'xhigh' is not supported by model 'sonnet'. Allowed values: default, low, medium, high, max.
```

## Session continuity

Add normalized reasoning configuration to `configFingerprint()` so a hot session is not reused under a different effort.

A matching hot pooled environment bypasses acquisition and does not reapply model or effort. This is safe only when the fingerprint includes reasoning and therefore proves the requested effort is unchanged. A changed effort must miss or evict the hot entry, then follow the cold/native-resume algorithm above.

Native session resume remains valid. Reapply model and effort on every acquire because:

- model selection changes the adapter's advertised effort values;
- stored sessions can outlive template edits;
- default must reset an earlier explicit value.

Reapplying configuration must not discard conversation history. A configuration error must occur before the next prompt and must not append a failed user turn.

## Pi implementation

Use the existing ACP method through `sandbox-agent`:

```ts
await session.setThoughtLevel(normalizedEffort)
```

No extension is necessary. The Pi extension remains responsible for Agenta tools, not model reasoning settings.

Pi-specific work:

- map default to `medium`;
- validate against adapter config options and the selected model's readback;
- detect clamping by reading `currentValue`; adapter 0.0.29 cannot provide an exact per-model allowed list;
- decide whether to upgrade Pi ACP before enabling `max` successfully;
- test two sequential sessions to prove a prior high value cannot leak into default.

## Claude implementation

PR #5213 provides the required local adapter version. The runner uses the same `setThoughtLevel()` call. Adapter 0.58.1 translates the ACP category to Claude SDK `effortLevel`.

Claude-specific work:

- always apply model before reading effort choices;
- use adapter `default` to clear a prior override;
- treat CLI settings and environment variables as operator precedence outside the template contract;
- define operator precedence for `CLAUDE_CODE_EFFORT_LEVEL` and settings before claiming provider-effective effort;
- test whether a higher-precedence operator source overrides the session flag even when ACP readback matches;
- upgrade the Daytona image separately before enabling the feature there.

## UI design

Add an Effort row directly below Model in the existing Model accordion.

Options:

| Stored value | Label |
| --- | --- |
| omitted or `default` from API callers | Model default |
| `off` | Off |
| `minimal` | Minimal |
| `low` | Low |
| `medium` | Medium |
| `high` | High |
| `xhigh` | Extra high |
| `max` | Maximum |

V1 behavior:

- Show the schema-level union.
- Explain that availability depends on the selected model.
- Preserve a saved value when the model or harness changes.
- Show always-present guidance for every explicit value that support depends on the selected model. V1 cannot selectively identify an unsupported saved value.
- Let runtime errors report the adapter's available evidence until a live per-model capability endpoint exists.

Add pure helpers in `SchemaControls/connectionUtils.ts`:

- `reasoningEffortFromConfig()` reads the first-class field and legacy fallback;
- `composeReasoningEffort()` updates only `reasoning.effort`;
- choosing Model default deletes `effort` and deletes `reasoning` only when the object is otherwise empty;
- unknown `reasoning` keys, `extras`, connection data, and model data remain unchanged.

## Observability

Record these non-secret attributes on the run or chat span:

- requested effort;
- adapter-reported effort;
- whether the adapter advertised the category.

The Python/service layer may separately record whether normalization used the first-class, legacy, or default source. The runner cannot know that provenance because the proposed wire intentionally carries only normalized effort.

Do not call `currentValue` provider-effective until precedence tests prove it. Do not record full config options or settings files. Log reset and mismatch errors with model and harness, but never credentials or environment contents.

