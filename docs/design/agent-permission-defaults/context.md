# Context

Agent settings currently expose a general permission default, harness rule editors,
and sandbox permission controls under Advanced. Pi activates seven built-in tools
independently of the saved tools list. New agents use Allow reads, so Bash and file
edits ask unless another rule overrides that default.

## Agreed behavior

- New Pi, Claude, and Codex agents use the general Allow default immediately.
- Existing agent configurations and request-level missing-policy fallbacks stay unchanged.
- Switching an existing agent's harness does not reset its permission policy.
- Agent configuration commits, discovery, tests, renames, and agreed listing operations
  are explicitly allowed in the playground build kit. The plan lists every operation.
- Integration additions use Allow all from both UI and builder guidance. Preserve
  explicit user restrictions.
- Move the general Permissions dropdown outside Advanced. Keep existing policy choices.
- Hide harness-specific and sandbox permission controls, including Daytona controls
  and the build kit's read-only sandbox permission display. Preserve their stored data.
- Keep build-kit availability controls in Advanced. Show execution-environment selection
  only when more than one valid deployment-enabled option exists.

## Non-goals

Do not introduce a new public policy schema, change API access checks, reset hidden
restrictions, or claim that the shared default controls every native harness action.
Do not change Claude or Codex native modes without spike evidence and a reviewed decision.

## Rollout

The template change affects new agents across all three harnesses. The shared build-kit
overlay affects subsequent playground runs for existing agents without changing their
saved configuration. Hiding controls is presentation-only, not a restriction migration.
