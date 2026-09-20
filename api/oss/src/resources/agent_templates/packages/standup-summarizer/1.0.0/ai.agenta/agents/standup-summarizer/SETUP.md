# Standup summarizer setup

Initial request: Build an agent that posts a daily standup digest of yesterday's channel activity.

Displayed trigger: Daily at 09:00
Trigger guidance: Runs every day at 09:00.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-and-post-to-the-channel` (required): Read and post to the channel. Options: slack, discord. Read channels, post digest
