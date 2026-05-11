# Fix: input_keys Not Saved on Commit

**Customer Issue:** When a user has 2 prompts in an app, fetching the API only returns the `input_keys` of the first configuration. The second prompt's `input_keys` are missing.

**Root Cause:** The `input_keys` field inside each prompt config (e.g., `ag_config.prompt.input_keys`) is not being updated/computed before commit. A refactoring removed the `syncInputKeysInPrompts` mechanism without replacing it.

## Files

| File | Description |
|------|-------------|
| `context.md` | Background, problem statement, and goals |
| `research.md` | Detailed codebase analysis and git archaeology |
| `plan.md` | Proposed fix with specific code changes |
| `status.md` | Current progress tracker |
| `legacy-entities-usage.md` | Notes on where old entities are still used |
