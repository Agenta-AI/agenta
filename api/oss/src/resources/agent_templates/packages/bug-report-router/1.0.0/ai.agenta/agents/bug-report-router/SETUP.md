# Bug report router setup

Initial request: Build an agent that turns support complaints into Linear bug tickets with repro steps.

Displayed trigger: New message or mention
Trigger guidance: Runs on a new support message or mention.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-report` (required): Read the report. Options: slack, intercom. Read threads, confirm filed tickets
- `file-the-bug` (required): File the bug. Options: linear, jira, github. Search & create issues
