# Dependency digest setup

Initial request: Build an agent that weekly summarizes open dependency-update PRs and what changed.

Displayed trigger: Weekly
Trigger guidance: Runs every week on a schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `list-and-read-dependency-prs` (required): List and read dependency PRs. Options: github, gitlab. Read pull requests
- `post-the-digest` (optional): Post the digest. Options: slack. Post the digest
