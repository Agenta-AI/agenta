# Onboarding buddy setup

Initial request: Build an onboarding buddy that answers new-hire questions from our internal wiki.

Displayed trigger: Mention
Trigger guidance: Runs when the agent is @-mentioned.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-onboarding-material` (required): Read the onboarding material. Options: notion, confluence. Read pages
- `reply-to-the-new-starter` (required): Reply to the new starter. Options: slack. Answer @mentions in-thread
