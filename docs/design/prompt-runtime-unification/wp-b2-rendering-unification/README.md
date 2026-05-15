# WP-B2 Rendering Unification

This workspace tracks WP-B2 from the prompt runtime unification RFC.

WP-B2 builds on WP-B1. WP-B1 extracted `render_template(...)`, the low-level string renderer. WP-B2 adds the next layer: shared rendering for prompt messages and JSON-return configuration.

## Files

- `rfc.md` - Technical proposal for message rendering, JSON-return rendering, Jinja error behavior, compatibility, and one-PR implementation sequencing.
- `research.md` - Current implementation map and relevant files.
- `plan.md` - Phased execution plan.
- `qa.md` - Test plan.
- `status.md` - Current decisions, blockers, and next steps.
