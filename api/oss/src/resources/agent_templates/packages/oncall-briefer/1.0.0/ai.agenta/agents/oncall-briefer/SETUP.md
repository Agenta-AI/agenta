# On-call briefer setup

Initial request: Build an agent that briefs on-call at 09:00 with all open incidents and their status.

Displayed trigger: Daily at 09:00
Trigger guidance: Runs every day at 09:00.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-errors` (required): Read the errors. Options: sentry. Read issues
- `post-the-brief` (required): Post the brief. Options: slack. Post the on-call briefing
- `name-the-on-call-engineer` (optional): Name the on-call engineer. Options: pagerduty. Name the on-call engineer
