# Pipeline digest setup

Initial request: Build an agent that posts a daily digest of pipeline changes and stale deals to Slack.

Displayed trigger: Daily
Trigger guidance: Runs once a day on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-deals` (required): Read the deals. Options: hubspot, salesforce, attio. Read deals
- `post-the-digest` (required): Post the digest. Options: slack. Post the pipeline digest
