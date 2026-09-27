# CRM updater setup

Purpose: reviews recent Gmail conversations, matches external correspondents to existing Attio people, and makes only contact updates directly supported by the messages.

## Prerequisites

- A Gmail account containing the prospect and business conversations to review.
- An Attio workspace containing the people records to maintain.
- Your company website, so the agent can understand your product, ideal customers, and what counts as a genuine prospect conversation.

## Connect your accounts

1. Connect your own Gmail account. The agent uses it to read received and sent conversations; it never drafts or sends mail without explicit approval.
2. Connect your own Attio workspace. The agent uses it to find people by email and update supported contact attributes.

## Choose your update mode

On first use, provide your company website and choose one mode:

- **Automatic (default):** apply and verify certain updates to existing Attio people without asking first.
- **Approval-first:** show every exact old-to-new change and wait for approval before updating.

Creating a new Attio person always requires explicit approval, regardless of mode.

## Suggested automation

The daily CRM email review is included as an inactive recipe for `09:00 UTC` each day. Before enabling it, review the schedule, timezone, 24-hour window, and update mode. Its packaged message requests approval-first behavior, so edit that message if you choose automatic updates.

## First-use check

Send: “My company website is https://example.com. Use approval-first mode and review the last 24 hours without making changes.”

A good answer identifies only genuine prospect or business conversations, links uncertain or unmatched cases, and proposes exact evidence-backed Attio changes without writing them.
