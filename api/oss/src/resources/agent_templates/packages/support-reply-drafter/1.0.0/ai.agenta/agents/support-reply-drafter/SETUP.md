# Support reply drafter setup

Initial request: Build an agent that drafts replies to new support tickets using answers from our docs.

Displayed trigger: New ticket
Trigger guidance: Runs when a new support ticket comes in.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-tickets` (required): Read the tickets. Options: zendesk, intercom. Read tickets, post draft replies
- `read-a-knowledge-source` (optional): Read a knowledge source. Options: notion, confluence, googledrive. Read a knowledge source
