# Default agent config

Make a new agent start useful. Pre-load its config with all the platform tools and the
default Agenta skill, present by default and removable. Workflow (reference) tools are left
as they are.

## Files

- `design.md` — the design. Problem, the injection-point finding, the locked decisions, the
  change set by layer, and the resolved ownership question.
- `research.md` — the code trace behind the design. Where the default comes from, how
  platform tools and skills are shaped, and why no disable flag exists today.
- `status.md` — current state, decisions, coordination, and out-of-scope items.

## In one line

The new-agent draft reads its values from the catalog template, which is backed by a bare
SDK default. Point the catalog template at the enriched default (frozen platform tools plus
the getting-started skill embed), keep the SDK builtin bare, so the defaults reach the draft
and stay removable.
