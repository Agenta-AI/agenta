# Status

Last updated 2026-10-13.

## State

The proposal is ready for review. No code has changed.

## Decisions

- Recommended: Option 4, a single active records consumer with retries that keep the order. See
  [options.md](options.md) for the reason.

## Open questions

- Should the records loop get its own deployment (Change 3), or should the whole stream worker go
  back to one replica until Change 3 lands? One replica is a one line change, but it also removes
  the extra replicas from the spans, events, and live relay loops.
- Should Change 4 run as a data migration for every deployment, or as a one-off script for the
  managed deployments only? Self-hosted deployments that scaled the stream worker have the same
  out of order rows.

## Related work

- A frontend change, in progress separately, renders a tool result whose call has not arrived yet.
