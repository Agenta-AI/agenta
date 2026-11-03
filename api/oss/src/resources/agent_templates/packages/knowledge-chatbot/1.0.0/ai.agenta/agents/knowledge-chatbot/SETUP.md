# Knowledge chatbot setup

Initial request: Build a customer-facing chatbot that answers questions from our knowledge base.

Displayed trigger: Mention or new message
Trigger guidance: Runs on mention or a new customer message.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-knowledge-base` (required): Read the knowledge base. Options: notion. Read pages
- `reply-to-the-asker` (required): Reply to the asker. Options: slack, discord, telegram. Reply to customer questions
