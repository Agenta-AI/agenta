---
name: write-social-announcement
description: Write social media posts that announce an Agenta release or feature on LinkedIn, X (Twitter) and Slack. Use when the user asks for a social post, a LinkedIn or X post, a tweet, a Slack announcement for the community or the team, or launch copy for a changelog entry, and when the create-changelog-announcement skill hands off the social copy.
---

# Write social media announcements

This skill writes posts for LinkedIn, X and Slack that announce an Agenta feature or release.

## Before you write

1. Load the `style-editing` skill and follow it for every sentence. It owns the word lists, the sentence rules and the patterns to leave out. This skill adds only the rules for each platform.
2. Read the changelog entry for the release under `docs/blog/entries/`. Take the facts from the entry and from the docs it links to. Don't add a claim that the entry doesn't support.
3. Use Agenta's current vocabulary: agents, sessions, revisions, harnesses, automations, channels and embeds. An automation "runs" a revision. It never "fires".
4. Link to the changelog entry at `https://agenta.ai/docs/changelog/<slug>`, where `<slug>` is the `slug` in the entry's frontmatter.

## Rules for every platform

- Say what the user can do now, and name the screen or the button where they do it.
- Vary the opening. Don't start every post with "We just shipped".
- Stop after the last fact. Don't close with a summary or a remark about why the release is important.
- Use no emoji, no hashtags and no exclamation marks.

## LinkedIn

- Write two to four short paragraphs, then the link on its own line.
- Write in the first person plural ("We added").
- Give one concrete detail that a reader can picture, such as a button name, a limit or a setup step.
- Put a code snippet in only when the feature is a command or a setting.

## X

- Write one post of 280 characters or fewer that says what shipped and what the user can do with it.
- Put the link in a second post. Write a thread only for a major release.
- A short list is fine in the first post when the release has two or three separate items.

## Slack

- **Community (`#announcements`)**: write a short message for users. Bullets are fine. End with the changelog link.
- **Internal (`#product-updates`)**: list what shipped, any numbers the team has, and any manual step that is still open, such as a self-host upgrade note. End with the changelog link.

## Examples

These examples use the entry `docs/blog/entries/whatsapp-channel.mdx`.

**LinkedIn, good:**

```
Agents in Agenta can now answer your customers on WhatsApp. You connect your WhatsApp Business number to an agent from its Publish button, and the agent replies to every customer who writes to that number.

Each customer's phone number is one conversation, so the agent keeps the context of earlier messages. When the agent needs approval to run a tool, the customer gets Approve and Deny buttons in the chat, and the agent also reads the images and documents that customers send.

You bring your own number through Meta's WhatsApp Cloud API, and setup needs a phone number ID, an access token and an app secret.

https://agenta.ai/docs/changelog/whatsapp-channel
```

**LinkedIn, bad:**

```
We just shipped a game-changing new channel for your agents! 🚀

Want to meet your customers where they are? Now you can. Your agent lives right inside WhatsApp — seamlessly handling approvals, media, and the 24-hour window.

It's not just a chatbot, it's your whole support team.
```

The bad version breaks the `style-editing` rules with puffery ("game-changing", "seamlessly"), a rhetorical question, a dash, a metaphor ("lives right inside") and a "not just X, it is Y" line. It also breaks the rules above with an emoji and an exclamation mark, and it gives no setup detail.

**X, good:**

```
Post 1:
Agenta agents can now answer customers on WhatsApp. Connect a WhatsApp Business number to an agent, and it replies to each customer with approval buttons, images and documents.

Post 2:
Changelog: https://agenta.ai/docs/changelog/whatsapp-channel
```

**Slack `#product-updates`, good:**

```
Shipped in v0.129.0: Agenta now emails the automation's creator once when an automation starts failing.
- The automations screen shows how each run ended: Succeeded, Failed, Cancelled or Asked for approval.
- Self-hosted deployments can turn the emails off with AGENTA_NOTIFICATIONS_EMAIL_ENABLED.
- Open item: Helm installs don't show run results or send the emails yet, because the cron host does not resolve there.
https://agenta.ai/docs/changelog/automation-failure-emails
```

## Check before you hand off

1. Does every sentence give a fact that the changelog entry supports?
2. Does the post pass the revision checklist in `style-editing`?
3. Does each post fit its platform's length and format?
4. Does the post end on the last fact and the link?
