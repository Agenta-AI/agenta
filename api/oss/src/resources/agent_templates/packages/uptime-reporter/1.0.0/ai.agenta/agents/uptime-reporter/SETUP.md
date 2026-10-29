# Uptime reporter setup

Initial request: Build an agent that posts a daily uptime and error-rate summary to Slack.

Displayed trigger: Daily
Trigger guidance: Runs once a day on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-errors` (required): Read the errors. Options: sentry. Read issues
- `post-the-report` (required): Post the report. Options: slack. Post the daily summary
- `read-uptime-context` (optional): Read uptime context. Options: datadog, newrelic. Read uptime context
