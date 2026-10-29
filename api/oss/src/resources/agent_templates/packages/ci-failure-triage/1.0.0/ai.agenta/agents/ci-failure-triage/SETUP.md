# CI failure triage setup

Initial request: Build an agent that reads the logs when CI fails, summarizes the likely cause, and pings the author.

Displayed trigger: Workflow run failed
Trigger guidance: Runs when a CI workflow run fails.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-runs-and-post-comments` (required): Read runs and post comments. Options: github. Read workflow runs, comment on commits
- `notify-a-channel` (optional): Notify a channel. Options: slack, discord. Notify a channel
