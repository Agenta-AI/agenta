# Error triage setup

Initial request: Build an agent that triages new Sentry errors by severity and files a ticket for real ones.

Displayed trigger: New error
Trigger guidance: Runs when a new Sentry error is captured.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-errors` (required): Read the errors. Options: sentry. Read issues
- `file-the-issue` (required): File the issue. Options: linear, jira. Search & create issues
