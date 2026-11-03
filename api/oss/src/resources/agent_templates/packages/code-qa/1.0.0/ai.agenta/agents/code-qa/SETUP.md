# Code Q&A setup

Initial request: Build a code Q&A agent that answers questions about our repo when mentioned.

Displayed trigger: Mention
Trigger guidance: Runs when the agent is @-mentioned.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-code` (required): Read the code. Options: github, gitlab. Read repo files & code
- `answer-on-a-slack-mention` (optional): Answer on a Slack mention. Options: slack. Answer on a Slack mention
