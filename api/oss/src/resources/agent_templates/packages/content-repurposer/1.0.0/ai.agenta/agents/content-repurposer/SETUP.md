# Content repurposer setup

Initial request: Build an agent that turns a published doc into draft LinkedIn and X posts for review.

Displayed trigger: Manual
Trigger guidance: Runs when you point it at a doc to repurpose.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-source-and-hold-drafts` (required): Read the source and hold drafts. Options: notion. Read & create pages
- `read-a-swappable-source` (optional): Read a swappable source. Options: googledrive. Read a swappable source
- `review-the-drafts` (optional): Review the drafts. Options: slack. Review the drafts
