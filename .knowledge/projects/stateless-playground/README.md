# Stateless Playground

Create a project level Playground page that is not bound to any app. It always runs against the shared completion service (and later chat). It treats everything as a draft and never allows saving.

Key constraint: reuse the existing Playground UI by swapping bindings (adapter) rather than rewriting components.

## User Request

"A playground page at the same level as evaluation or prompts (project level) that is bound to no app. Always uses the same URL for the service (the completion service). All variants/revisions are drafts and you cannot save anything. Allows creating a prompt, running it, and adding test cases. It is the usual playground experience, but it is not connected to a prompt."

## Files

- **[context.md](./context.md)** - Background, motivation, goals, non-goals
- **[research.md](./research.md)** - Codebase analysis and key findings
- **[rfc.md](./rfc.md)** - Technical proposal for the adapter based approach
- **[plan.md](./plan.md)** - Implementation plan with phases
- **[status.md](./status.md)** - Current progress, blockers, and decisions
- **[api-design.md](./api-design.md)** - Data flow and API contracts
- **[qa.md](./qa.md)** - QA plan and test scenarios

## Quick Links

- Current Playground UI and atoms: `web/oss/src/components/Playground/`
- Completion service: `services/oss/src/completion.py`
- Service schema fetching: `web/packages/agenta-entities/src/appRevision/api/schema.ts`
- Loadable bridge (local mode testcases): `web/packages/agenta-entities/src/loadable/`
