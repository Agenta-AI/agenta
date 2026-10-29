# PR reviewer setup

Initial request: Build a PR reviewer that comments inline on risky changes and flags missing tests.

Displayed trigger: Pull request opened
Trigger guidance: Runs when a pull request is opened.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-the-diff-and-post-review-comments` (required): Read the diff and post review comments. Options: github, gitlab. Read PRs, post reviews & comments
