# WP27 — tasks

Spec: [specs-wp27.md](specs-wp27.md). Design: `hosted-app.md`, `D32`–`D36`.

Branches from WP26 at M1. Do not start against an unmerged WP26 — the same page and
the same route family are underneath both.

## Configuration

- [ ] Client id, client secret and the app signing secret in `utils/env.py`,
      consumed through the shared `env` object. Never `os.getenv` in service code.
- [ ] Bare `VAR=` lines in the env example files, with no comments. The explanation
      belongs in the self-host documentation.
- [ ] With none of them set: the install route refuses with a reason, and the web
      button is absent. Neither path 500s.

## The flow

- [ ] Install route — mint the state with the existing signer, shorter age, then
      redirect to Slack's authorize URL with our client id, scope set and redirect
      URL.
- [ ] Callback route — decode the state first. Unknown, expired or tampered is
      refused **before** any exchange.
- [ ] Handle `error=access_denied` as a normal outcome with a page saying the
      install was cancelled, not as an error.
- [ ] Exchange the code at `oauth.v2.access`. New code — nothing in the repo has
      done this before, so do not copy the gateway callback's shape.
- [ ] Read `app_id`, `access_token`, `bot_user_id`, `team.id`, `enterprise.id`,
      `is_enterprise_install` and `scope` from the response.
- [ ] `auth.test` with the new token before storing anything. Verified must mean one
      thing, and this is the one path that sets it.
- [ ] Compose the identity through the existing function: `api_app_id` from
      `app_id`, discriminator `enterprise.id` when the install is org-wide and
      `team.id` otherwise.
- [ ] **Upsert on the composed key.** Existing identity: replace the secret body,
      keep the row id, keep its grants, spaces and threads.
- [ ] Store the bot token as the whole credential body. No `signing_secret` — it is
      ours, not this connection's.
- [ ] Record the granted scopes on the connection.

## The two-source verification secret

- [ ] The adapter resolves the signature secret: the connection's vault row for a
      customer-owned connection, configuration for a hosted one.
- [ ] One terse line at the resolution point saying a hosted connection has no
      `signing_secret` **by design**. This is the sentence that stops somebody
      "fixing" it into a refusal.
- [ ] Core stays unaware that app models exist. If a core file learns the word
      "hosted", the branch is in the wrong place.

## The declaration, narrowed per connection

- [ ] The app model removes commands, modals and event subscriptions from a hosted
      connection's declaration.
- [ ] The granted scopes remove what a declined scope entitled.
- [ ] A hosted connection declares `commands.native: false`. **There is no toggle to
      hide** — nothing lets an operator enable a command yet, and native commands are
      dropped today anyway (`F52`). The obligation is to the declaration, so that a
      later surface cannot offer what can never fire.
- [ ] The drift indicator does not render on a hosted connection.
- [ ] **Unit** — a hosted connection's declaration reports no native commands and a
      customer-owned one still does. This is the test that stops the narrowing being
      quietly dropped.

## Uninstall

- [ ] `app_uninstalled` and `tokens_revoked` set `flags.is_active = false`. Never
      delete.
- [ ] Removing the connection in Agenta revokes the installation on Slack's side.
- [ ] The removal copy differs from the customer-owned page, which says we cannot.

## Tests

- [ ] **Unit** — verification secret resolves from the vault for customer-owned and
      from configuration for hosted. Both directions.
- [ ] **Unit** — a hosted connection with no `signing_secret` verifies and is never
      treated as unconfigured.
- [ ] **Unit** — a second install for one identity keeps the row id. Assert the id,
      not the row count.
- [ ] **Unit** — unknown, expired and tampered states are each refused with the
      exchange never called.
- [ ] **Unit** — no client credentials configured: the install route refuses with a
      reason.
- [ ] **Integration** — `app_uninstalled` deactivates and leaves grants, spaces and
      threads in place.
- [ ] `ruff format` then `ruff check --fix` in `api/`; `pnpm lint-fix` in `web/`.

## Watch for

- **Never log the client secret, an authorization code or a token**, including on
  error paths, and redact them out of any stored `processed` payload.
- **`api_app_id` is the same for every hosted connection**, so the discriminator
  carries the whole identity. A bug that drops it merges two workspaces silently
  into whichever row came back first.
- **The exchange and the verify are two calls that both prove the token.** Keep
  both anyway — one meaning of verified is worth one redundant call.
