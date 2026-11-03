# Newsletter drafter setup

Initial request: Build an agent that drafts a weekly newsletter from our recent shipping activity.

Displayed trigger: Weekly
Trigger guidance: Runs every week on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `hold-the-draft` (required): Hold the draft. Options: notion. Read & create pages
- `read-what-shipped` (required): Read what shipped. Options: github, linear. Read merged PRs
