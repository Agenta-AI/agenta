# Agent thinking effort

Status: proposed for review

This project adds an author-facing model effort control to agent templates and carries it through the Python SDK, `/run` wire contract, runner, Pi, Claude, and playground UI.

The proposed template shape is:

```json
{
  "agent": {
    "llm": {
      "model": "sonnet",
      "reasoning": {
        "effort": "high"
      }
    }
  }
}
```

The central recommendation is to treat effort as model configuration, not as harness configuration or an adapter-specific setting. Both Pi and the upgraded Claude ACP adapter expose effort through ACP's `thought_level` category, so the runner can use one semantic field and one runtime operation while still validating each model's supported values.

## Proposed decisions

1. Use `parameters.agent.llm.reasoning.effort` as the stored author contract.
2. Accept `default`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` as the schema-level union.
3. Omit the wire field for `default`; the runner treats omission as a deterministic reset.
4. Reject unsupported explicit values before prompting. List allowed values when the adapter exposes an exact set; otherwise report the requested and adapter-reported values. Never silently clamp or downgrade an author's choice.
5. Read legacy `llm.extras.reasoning_effort` when the new field is absent, normalize legacy `none` to `off`, and prefer the new field when both exist.
6. Apply model first, then effort, and read the value back before prompting.
7. Place the UI control directly below Model in the existing Model accordion.

## Review questions

- Should the public union include `max` now, even though Pi ACP 0.0.29 does not advertise it yet? This plan says yes, with strict runtime capability validation.
- Should Pi's deterministic `default` map to its built-in `medium`? This plan says yes to prevent a previous session's persisted setting from leaking.
- Should the UI initially show the full union with runtime validation, or wait for a runner capability endpoint that can filter per model? This plan recommends the full union plus always-present model-support guidance for explicit values in v1.
- Is the proposed legacy fallback window sufficient, or should we also write a migration job for stored revisions? This plan recommends read compatibility only.

## Documents

- [Context](context.md)
- [Research](research.md)
- [Technical design](design.md)
- [Implementation plan](plan.md)
- [QA plan](qa.md)
- [Status](status.md)

## Related delivery

- Claude ACP adapter upgrade: [PR #5213](https://github.com/Agenta-AI/agenta/pull/5213)
- Upstream Claude effort support landed in [claude-agent-acp PR #464](https://github.com/agentclientprotocol/claude-agent-acp/pull/464).

