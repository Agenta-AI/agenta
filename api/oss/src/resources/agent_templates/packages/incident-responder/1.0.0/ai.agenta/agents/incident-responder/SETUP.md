# Incident responder setup

Initial request: Build an incident responder that gathers context on new alerts and pages on-call.

Displayed trigger: On alert
Trigger guidance: Runs when a new alert fires.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-errors` (required): Read the errors. Options: sentry. Read alerts & issues
- `notify-or-page` (required): Notify or page. Options: slack, pagerduty. Post the incident summary
- `read-extra-context` (optional): Read extra context. Options: datadog, newrelic. Read extra context
