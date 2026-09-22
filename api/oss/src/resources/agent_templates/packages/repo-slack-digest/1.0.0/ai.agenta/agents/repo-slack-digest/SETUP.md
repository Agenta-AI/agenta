# Repo Slack digest setup

Initial request: Build an agent that twice a day posts a digest of new issues, commits, and PRs to Slack.

Displayed trigger: 2x daily
Trigger guidance: Runs twice a day on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-repository-activity` (required): Read repository activity. Options: github, gitlab. Read issues & pull requests
- `post-the-digest` (required): Post the digest. Options: slack, discord. Post the repo digest
