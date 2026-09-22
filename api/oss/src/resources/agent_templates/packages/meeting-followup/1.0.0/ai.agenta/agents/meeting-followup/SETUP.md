# Meeting follow-up setup

Initial request: Build an agent that drafts a follow-up email after each meeting and logs notes to the CRM.

Displayed trigger: Meeting ends
Trigger guidance: Runs after a calendar meeting ends, or on schedule.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `draft-the-follow-up` (required): Draft the follow-up. Options: gmail. Read meeting notes, draft the follow-up
- `read-the-meeting` (optional): Read the meeting. Options: googlecalendar. Read the meeting
- `update-the-crm` (optional): Update the CRM. Options: hubspot, salesforce, attio. Update the CRM
