# Status

> Historical v0 proposal. This is a good starting point, but it may miss important
> requirements and design questions. Its choices are not approved requirements.
> Read the [current requirements](../requirements.md) and
> [open design questions](../design-questions.md) before using this proposal.

## Current state

- Research and candidate implementation plan updated September 7, 2026 for ChatGPT and SuperGrok
  onboarding.
- The planning workspace and interactive architecture walkthrough are ready for review.
- No implementation changes have been made.
- Self-hosted subscription execution and sanitized status reporting already exist in the codebase.
- Hosted per-user runner selection and browser connection onboarding do not exist.
- Codex exposes a structured device-login API through `codex app-server`.
- Grok Build exposes device login and Agent Client Protocol inference, but its public documentation
  does not expose a machine-readable login-control API.
- Both designs need an integration proof that model-started shell and file tools cannot read the
  mounted authentication home while the parent harness can still refresh it.

## Decisions needed before implementation

1. First release access: only the connecting user can use the connection, and only for interactive
   turns.
2. First release concurrency: one active run per subscription connection.
3. Grok login control: obtain a supported machine-readable device-login contract from xAI, or
   accept a pinned Grok CLI terminal parser as a temporary dependency.
4. Storage: one encrypted persistent volume per connection for the first release.
5. Service ownership: the main FastAPI API owns public connection records and user checks. The
   runner owns private login operations.
6. Infrastructure ownership: decide who operates hosted runners and encrypted authentication
   storage.
