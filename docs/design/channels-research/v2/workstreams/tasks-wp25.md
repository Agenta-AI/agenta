# WP25 — tasks

Spec: [specs-wp25.md](specs-wp25.md). Design: `agenta-channel.md`, `rendering.md`.

Starts after WP24 merges. Own repo area; touches no API file.

## The flag

- [ ] Third atom in `web/oss/src/state/settings/featureFlags.ts`, same
      `atomFamily` + `atomWithStorage` shape as the two beside it.
- [ ] Row on the settings Feature Flags page.
- [ ] Default **off**. Nothing reachable and nothing rendered when off.

## The surface

- [ ] Bot picker — connections list filtered to `channel = "agenta"`.
- [ ] Conversation list and "New conversation" (which is `!new` — append a thread).
- [ ] Composer — `POST /channels/agenta/events/` with the user's API key.
- [ ] Poll the read route; append new messages.
- [ ] Choice buttons post the choice token as an ordinary message.

## Rendering — the part that outlives the components

- [ ] Every node in `rendering.md`: `text`, `buttons`, `select`, `fields`, `table`,
      `image`.
- [ ] Every node's **degraded** form too, behind a toggle or query parameter:
      numbered list for buttons and select, `label: value` lines for fields, first
      column for table, bare URL for image.
- [ ] `divider` and `section` are deliberately absent from the vocabulary — do not
      add them.

## Minimal configuration

Three forms over WP23's routes, enough to reach the chat without curl:

- [ ] Create a bot.
- [ ] Add an agent by slug, mark default.
- [ ] Set one grant: `ALLOW`, `kind = private`.

Nothing more. The real configuration surface is C6's.

## Tests

- [ ] Package unit tests per the frontend conventions in `web/AGENTS.md`.
- [ ] Each node type renders; each degraded form renders. These outlive the
      components; the rest of the UI does not need coverage.
- [ ] `pnpm lint-fix` in `web/` before committing.

## Done when

- [ ] Flag on: create a bot, open a conversation, send, read the answer, click a
      choice.
- [ ] Flag off: nothing reachable.
- [ ] Every node rendered at least once, richly and degraded.

## Watch for

- **Resist polish.** Every hour spent on layout here is deleted when web builds the
  real surface. The deliverable is that the API was driven and the vocabulary
  rendered.
- **Do not add API routes.** If something is missing, it is WP23's or WP24's and
  should be raised there — a web-only endpoint would be the thing this package
  exists to avoid.
