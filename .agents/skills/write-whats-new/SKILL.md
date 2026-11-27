---
name: write-whats-new
description: Write the in-app "What's new" copy and the matching docs changelog entry for an Agenta release, the way Mahmoud approves it the first time. Covers the title, the summary, lists of models, improvements and fixes, what to leave out, and the cover picture. Use when writing or reviewing a changelog entry for a version, the What's new dialog text, or release notes that people read in the app.
---

# Write the What's new copy

The "What's new" dialog in `/m` (`web/mobile/src/features/education/WhatsNewDialog.tsx`) opens on
Home when a release came out that the browser has not seen. Its text comes from the docs
changelog entries in `docs/blog/entries/*.mdx`: the `<Summary>` block, the `improvements` and
`fixes` lists in the frontmatter, and the `cover` field. `pnpm generate:releases` in `web/`
builds `web/packages/agenta-navigation/src/releases/changelog.json` from them. Do not hand-edit
that file.

The procedure for the docs page itself (slug, frontmatter, `<Summary>`, `{/* truncate */}`, the
full write-up) is in the `create-changelog-announcement` skill. This skill sets how the text
reads.

## Write for the person who uses the app

- Say what the person can now do, and why it helps them. Do not describe how it works inside.
  Before: "The runner reuses local tool binaries and a harness capability probe."
  After: "Agent chats start faster."
- Use the names the app shows: screen names, button labels, model names as the model picker
  shows them. Bold a button or screen name: **Settings**, **Builder**.
- Leave out internal names: runner, harness (Pi, Codex, Claude Code as a harness), spans,
  baggage, Composio, library names such as pypdf, ids, env vars.
- Call the builder "the builder agent" the first time, then "the builder".
- Do not describe UI mechanics that people see anyway, such as "each change shows as a card".

## The parts of one entry

1. **Title.** What the person gets, in plain words. The timeline row in the dialog shows about
   26 characters, so put the meaning in the first words. Examples that were approved:
   "Meet the builder agent", "New models for your agents",
   "Discord, Microsoft Teams and localization".
2. **Summary.** One or two short paragraphs. Start with what changed for the person, then where
   to find it, then what it can do. A closing line such as "We will keep making it better" is
   fine for a new feature.
3. **Lists, not sentences, for many names.** When a release adds models, list each model on
   its own line, grouped by how the person pays for it:
   - "Built-in models, paid with your Agenta credits like the other built-in models. You need
     no key of your own:" then the list.
   - "With your own provider key or subscription:" then the list.
   Write the full model name ("Claude Fable 5.2", "GPT-6.2 Sol"). Never name the harness.
4. **Improvements and fixes.** One line each, with an area label (Agents, Automations,
   Sessions, Integrations, Phone). Say what the person sees. A change that makes something
   work as it should is a fix, not an improvement (for example "Codex now asks before it edits
   a file when the tool policy says to ask").

## Leave out

- Dependency and security version bumps ("Updated Next.js and Hono"). They are not useful to
  the reader.
- Features that have no place in the app's screens yet. Announce them when the UI ships. (Shared
  drives shipped in v0.129.0 without a UI, so no entry names them yet.)
- Small setting removals that nobody asked for (for example removed developer switches).
- Self-hosting upgrade steps. They stay in the full docs page, not in the summary.

## Cover

Every new entry gets a cover above its title. Mahmoud likes covers. Build them from pictures the
app already has, never from new art:

- Channel logos from `web/packages/agenta-settings-ui/src/channels/icons.tsx`
  (Slack, Telegram, WhatsApp, Discord, Teams).
- Model provider logos from `web/packages/agenta-ui/src/icons/llm-icons/` (Gemini, Anthropic, OpenAI,
  Mistral and others), next to chips with the model names.
- The builder's ribbon animation (`web/mobile/src/features/builder-page/hero/`).
- Language names as chips, each in its own language.

Set the cover in the entry's frontmatter (`cover: channels`, `models`, `builder`, ...). A demo
video (`streamVideoId`) replaces the cover when the entry has one. A new kind of cover needs one
small component in `web/mobile/src/features/education/`.

## Review before you show Mahmoud

- Put the dialog on an artifact page, today and proposed side by side, with the real `/m`
  tokens, so he can comment per entry. Count the title characters and mark the ones the
  timeline cuts.
- Read each line as a user who has never seen the code. If a line needs the code to make sense,
  rewrite it or drop it.
- Check each claim against the code or the PR. For example, do not say the builder "creates
  automations" while its instructions say it cannot.
