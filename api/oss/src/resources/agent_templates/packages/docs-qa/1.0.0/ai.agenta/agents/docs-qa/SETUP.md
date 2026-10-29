# Docs Q&A setup

Initial request: Build a docs Q&A agent that answers questions from our workspace with cited answers.

Displayed trigger: On mention
Trigger guidance: Runs when the agent is @-mentioned.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-documentation` (required): Read the documentation. Options: notion, confluence, googledrive. Read pages
- `read-an-extra-source` (optional): Read an extra source. Options: slack. Read an extra source
