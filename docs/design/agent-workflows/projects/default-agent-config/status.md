# Status: default agent config

## Where we are

Research done (`research.md`). Injection point confirmed in code and decided. Design final
in `design.md`, all decisions locked. Ready for the consolidated design-docs PR.

## Decisions settled (by Mahmoud)

1. Default skill is embedded, not forced. Stop force-injecting getting-started; keep the
   `force_skills` mechanism for later.
2. Delete-only for v1. No `is_active` flag now.
3. Platform tools are a frozen, explicit list, read from the catalog at build time.
4. Defaults must surface where the new-agent draft reads them.
5. Injection point: the catalog template carries the enriched default. The bare SDK builtin
   interface stays bare. `/inspect` is not used for the draft's values; it is kept in sync
   only so the service default and the runtime fallback do not drift.

## Injection point (confirmed and decided)

The new-agent draft reads its editable values from the catalog
(`template.data.parameters`), not from `/inspect` (the draft uses `/inspect` for schemas
only). The catalog default comes from the bare SDK interface today
(`build_agent_v0_default()` with no skill, no tools). The service `/inspect` enriches a
default the draft never reads. That split was the gap. Fix: point the catalog template at
the enriched default (platform tools plus the skill embed), keep the SDK builtin bare, keep
`/inspect` in sync.

## Coordination

A separate skills subagent owns the getting-started skill content and naming. This project
owns embed-by-default (the skill arrives as a removable embedded default config item). Do
not write skill content here.

## Out of scope (noted)

- Disable-but-keep (`is_active` + resolver/wire drop).
- Debug-mode UX where defaults are not shown.
- A picker to add platform tools or skills back after deleting.
- Real getting-started skill content.
