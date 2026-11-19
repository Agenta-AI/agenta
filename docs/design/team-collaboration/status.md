# Team collaboration status

**Status:** Research and first PRD/RFC draft complete. No implementation started.

## Documents

- Interactive visual walkthrough: complete and available in `walkthrough.html`.
- Competitive research: complete.
- High-level PRD: drafted.
- RFC 0, Authorization consistency: drafted.
- RFC 1, Session audiences: drafted.
- RFC 2, Session sharing: drafted.

## Decisions needed before implementation

1. Confirm `manage_projects` as the initial Project-management capability.
2. Confirm Organization security remains owner-only for the first fix.
3. Confirm personal API keys die with Project membership and service accounts remain separate.
4. Decide the Viewer target for billable execution and billing visibility. Plaintext secret reveal
   is removed from Viewer as a security fix.
5. Decide whether session entry points determine the default audience.
6. Confirm ownerless personal sessions freeze until a separate recovery policy is approved.
7. Confirm named sharing launches View-only and does not expose Join yet.

## First safe implementation slice

The **My sessions** server-filtered view can ship without changing authorization if the UI keeps the
**Project members** audience label and avoids privacy language. Backend authorization fixes can
proceed in parallel. No private audience or sharing control should ship before RFC 0 and the full
RFC 1 enforcement surface are implemented.
