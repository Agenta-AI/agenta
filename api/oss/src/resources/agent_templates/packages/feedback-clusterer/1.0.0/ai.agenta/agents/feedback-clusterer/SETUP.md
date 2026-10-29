# Feedback clusterer setup

Initial request: Build an agent that daily clusters new customer feedback into themes and logs them to Notion.

Displayed trigger: Daily
Trigger guidance: Runs once a day on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-feedback` (required): Read the feedback. Options: slack, intercom. Read channels, post theme summaries
- `log-the-clusters` (required): Log the clusters. Options: notion. Log clusters to a page or database
