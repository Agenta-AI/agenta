# Support triage setup

Initial request: Build a support triager that reads new #support threads, tags urgency, and routes to owners.

Displayed trigger: New message in #support
Trigger guidance: Runs whenever a new message is posted in #support.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-and-post-in-the-support-channel` (required): Read and post in the support channel. Options: slack, discord. Read channels, post & assign threads
