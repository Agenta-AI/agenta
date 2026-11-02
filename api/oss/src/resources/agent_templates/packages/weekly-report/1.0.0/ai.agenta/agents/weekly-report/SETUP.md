# Weekly report setup

Initial request: Build an agent that compiles a weekly report of shipping and product metrics to Notion.

Displayed trigger: Weekly
Trigger guidance: Runs every week on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-shipped-work` (required): Read the shipped work. Options: github. Read pull requests
- `publish-the-report` (required): Publish the report. Options: notion, slack. Publish the report
- `read-product-metrics` (optional): Read product metrics. Options: posthog. Read product metrics
