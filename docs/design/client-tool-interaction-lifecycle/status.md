# Status

2026-08-10 evening.

## Done

- Research complete, evidence-backed, rewritten in plain language.
- Blame history checked against version 0.108: the root defect was never a regression;
  two recent changes made it visible (details: research Finding 3).
- Plan version 1 rejected by an adversarial review (nine findings; the decisive one:
  recording the answer at delivery time loses a race against the cleanup sweep).
- Plan version 2 written: four changes, smaller, race-safe by ordering.
- qa.md written: why every layer missed this, and six standing checks.
- Docs shipped for review: PR #5916.

## Next

- Mahmoud's go/no-go on plan version 2.
- On go: implement Change 1 first (everything else reads the states it creates).

## Standing decisions

- One contract instead of more symptom patches.
- No new record types, no new event payloads, no database migration.
- Mobile form/connect answering stays a separate ticket.
- The one-line dispatch repair lands immediately, outside this project.
