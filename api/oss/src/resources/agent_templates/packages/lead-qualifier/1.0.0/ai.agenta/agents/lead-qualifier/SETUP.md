# Lead qualifier setup

Initial request: Build an agent that enriches each new inbound lead, qualifies it, and adds it to HubSpot.

Displayed trigger: New lead or email
Trigger guidance: Runs when a new lead or inbound email arrives.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `write-the-qualified-lead` (required): Write the qualified lead. Options: hubspot, salesforce, attio. Read & create contacts
- `read-inbound-email-leads` (optional): Read inbound email leads. Options: gmail. Read inbound email leads
