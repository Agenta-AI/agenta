# Issue triage setup

Initial request: Build an issue triager that labels new issues by area and priority and assigns an owner.

Displayed trigger: Issue opened
Trigger guidance: Runs when a new issue is opened.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-and-label-new-issues` (required): Read and label new issues. Options: github, gitlab. Read issues, apply labels & assignees
- `cross-post-the-triaged-issue` (optional): Cross-post the triaged issue. Options: linear, jira. Cross-post the triaged issue
