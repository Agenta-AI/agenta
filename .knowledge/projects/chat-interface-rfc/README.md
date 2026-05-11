# Chat Interface for Custom Workflows RFC

This workspace contains the planning and implementation documentation for enabling custom workflows to work as chat applications in Agenta.

## Files

- **[context.md](./context.md)** - Background, motivation, and goals
- **[rfc.md](./rfc.md)** - The full RFC document (as provided)
- **[research.md](./research.md)** - Codebase analysis and technical findings
- **[plan.md](./plan.md)** - Implementation plan with phases
- **[status.md](./status.md)** - Current progress and decisions

## Quick Summary

**Goal:** Enable custom workflows to declare `is_chat: true` so Agenta can treat them as chat applications.

**Approach:** Add `flags` support to legacy `@ag.route`/`@ag.entrypoint`, emit `x-agenta.flags.is_chat` in the legacy OpenAPI operation(s), and have the frontend prefer that signal for chat detection (with heuristics as fallback). Also align the new `@ag.route` to accept `flags` for consistency.

**Current Phase:** Phase 1 - SDK Changes
