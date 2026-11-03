# Cross-tool sync setup

Initial request: Build an agent that mirrors new Linear issues into a Notion tracker every hour.

Displayed trigger: Hourly
Trigger guidance: Runs every hour on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-from-the-source-tool` (required): Read from the source tool. Options: linear, jira. Read issues
- `write-to-the-destination-tool` (required): Write to the destination tool. Options: notion, confluence, github. Create & update tracker pages
