# Context

## Problem

Authors can choose a model in an agent template, but they cannot reliably choose how much that model should reason. The current schema allows arbitrary `llm.extras`, and examples mention `reasoning_effort`, but that value stops before the runner. The harness adapters pass only a model string and the `/run` request has no effort field.

That creates three confusing states:

- a template can store `llm.extras.reasoning_effort` without changing execution;
- Pi and Claude Code each have native effort controls outside Agenta, but those settings are global or project-scoped rather than revision-scoped;
- the old Claude ACP adapter did not expose effort even though the current adapter does.

## What users can do without Agenta support

Pi does not need an extension for this. It reads `defaultThinkingLevel` from `~/.pi/agent/settings.json` or `.pi/settings.json`, and its session API can set the thinking level directly. The limitation is ownership: those files configure a user or project, not one immutable Agenta agent revision.

Claude Code supports `/effort`, the `--effort` flag, `CLAUDE_CODE_EFFORT_LEVEL`, `effortLevel` in settings, and skill or subagent frontmatter. Its documented precedence puts the environment variable above configured session settings. These are useful local overrides, but placing Agenta's revision-level intent in `~/.claude/settings.json` would make agents interfere with one another and would not work consistently across sidecars and remote sandboxes.

References:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Claude Code settings scopes](https://code.claude.com/docs/en/settings)
- [Pi settings](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md)

## Goals

- Let template authors persist an effort choice with the model configuration.
- Give UI authors a clear Model default option and named effort levels.
- Preserve one semantic contract across Pi and Claude.
- Validate against the active model after model selection.
- Reset effort deterministically when a template removes an override.
- Preserve warm-session and durable-session behavior when effort changes.
- Keep legacy stored revisions readable.

## Non-goals

- Define a universal token budget for each effort name.
- Promise every effort value on every model.
- Add a Pi extension solely for effort.
- Configure user-level Pi or Claude files from the Agenta UI.
- Upgrade the Claude adapter baked into the Daytona image as part of the template feature.
- Add a live per-model capability endpoint in the first implementation unless static UI validation proves too confusing.

## Success criteria

An author can save an effort in the template, see it in the UI, run the revision through Pi or Claude, and get either:

- an adapter-reported value that exactly matches the explicit request, with separate provider-precedence QA before calling it provider-effective; or
- a clear pre-prompt error that names the unsupported value and lists exact values when the adapter exposes them, or reports the requested and clamped values when it does not.

Removing the override must restore deterministic defaults instead of inheriting the prior run.s effort. This intentionally changes behavior for old producers whose requests omit effort: after the runner feature ships, omission becomes an active reset instead of doing nothing.

