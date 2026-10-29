# Changelog writer setup

Initial request: Build a changelog writer that turns merged pull requests into release notes and publishes them.

Displayed trigger: On release
Trigger guidance: Runs when a release is published.
Treat this trigger text as setup guidance only. Do not activate an automation unless the user asks for it and confirms its exact settings.

Connection choices:
- `read-merged-pull-requests` (required): Read merged pull requests. Options: github, gitlab. Read merged PRs, publish releases
- `publish-the-changelog` (required): Publish the changelog. Options: notion, linear. Publish the changelog
