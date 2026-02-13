# Status

Last updated: 2026-01-21

## Current state
- Implemented a bounded settle wait. The modal now closes on commit success unless the committed revision was selected and needs a short selection swap.
- Added a 1.5 second timeout so the modal never waits indefinitely.
- The variant drawer now updates the `revisionId` query param on commit success so it points at the new revision.

## Open questions
- Which settle time budget feels right (for example 1 to 2 seconds) before we close and let refresh happen in the background.
- Whether we want to keep the modal open through the deploy step, or close and show a separate deployment status message.

## Next actions
- Validate commit flows (playground, variant drawer, new variant, deploy after commit).
- Decide if we want a success toast when we close before the revisions list finishes refreshing.
