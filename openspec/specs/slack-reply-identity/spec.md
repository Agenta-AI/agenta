# Slack reply identity

## Purpose

Describe the sender identity used for Slack replies in PR #6737 at `658d6f5edae34d861d141a38604ef7a12a7b69c8`. See [source evidence](../../evidence.md).

## Requirements

### Requirement: Outbound sender identity
The Slack adapter SHALL post with the installed bot's identity. Its outbound contract SHALL NOT accept an agent sender profile. It SHALL NOT send `username` or `icon_url` in `chat.postMessage` requests.

#### Scenario: Two agents answer through one installation
- **WHEN** different channel agents post through the same connection
- **THEN** Agenta SHALL use the installed bot identity for both replies.

### Requirement: Progress and answer delivery
The outbox SHALL use the thread locator for an item's first post. Where updates are supported, later content SHALL edit the stored receipt. Slack posts SHALL contain destination, text, and optional blocks; updates SHALL use the receipt's channel and timestamp.

#### Scenario: Answer replaces progress
- **WHEN** an item already has a Slack receipt and its answer is ready
- **THEN** the outbox SHALL update that message rather than change its sender through an identity parameter.

#### Scenario: First response
- **WHEN** an item has no prior receipt
- **THEN** the outbox SHALL use the thread's external locator for the initial Slack post.
