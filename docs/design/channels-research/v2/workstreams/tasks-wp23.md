# WP23 — tasks

Spec: [specs-wp23.md](specs-wp23.md). Design: `journeys.md`.

Starts after WP22 merges.

## The setup declaration

- [ ] `ChannelSetup`, `ChannelSetupField`, `ChannelSetupDoc` in
      `core/channels/dtos.py`.
- [ ] `ChannelCapabilities` gains `setup: ChannelSetup`, defaulting to empty.
- [ ] `build_setup_document(*, request_url)` on the interface, defaulting to `None`.
- [ ] `verify_connection(*, connection, credentials)` on the interface, defaulting
      to returning `{}` — a channel with nothing to verify verifies trivially.
- [x] Slack declares: instructions, a document (the existing
      `build_slack_manifest`), and **three** fields — `bot_token` and
      `signing_secret`, both secret, plus `api_app_id`, which is not. **Not**
      `team_id` or `bot_user_id`; those are discovered.

      This line said two fields and was wrong: `journeys.md` S3 settles that
      `api_app_id` must be asked for, because `auth.test` does not return it for a
      pasted bot token — and the connection's identity composes from it.
- [x] Slack's `verify_connection` calls `auth.test` and returns `team_id`,
      `bot_user_id` where present. `api_app_id` is asked for, not discovered.
- [ ] Agenta declares all three slots empty.

## Routes

- [ ] `POST /channels/connections/` — `EDIT_CHANNELS`.
- [ ] `POST /channels/connections/{id}/edit` — rename, re-slug, rotate credentials.
- [ ] `POST /channels/connections/{id}/archive` and `/unarchive`.
- [ ] `GET /channels/connections/{id}/setup` — declaration plus generated document.
- [ ] Re-point `query_channel_connections` at `channel_connections`. Keep the
      trailing slash on the collection route.
- [ ] Every route names an `operation_id` and a `response_model` with
      `response_model_exclude_none=True`, per D31.
- [ ] Wiring block for `api/entrypoints/routers.py` prepared **as a diff**, applied
      at the checkpoint. Never edited mid-stream.

## Create, in this order

- [ ] Call `verify_connection` **before any write**.
- [ ] On failure: write nothing, surface the platform's own error.
- [ ] Compose `external_key` at `CONNECTION` grain from the locator merged with what
      verification discovered.
- [ ] Write the `CHANNEL_SECRET` row.
- [ ] Write the `channel_connections` row referencing it, status verified.
- [ ] Docstring notes the inverted order for channels whose setup call *writes*
      (Telegram's `setWebhook`): store, call, verify. Do not implement it.

## Secrets

- [ ] No route returns a credential value. A configured field reads as set.
- [ ] Rotation replaces the secret row's contents after re-verification, and does
      **not** move `external_key`.
- [ ] Redact known credential field names on inbox/outbox `processed` payloads.

## Teardown

- [ ] Archive, not delete. Cascades to the connection's channels rows.
- [ ] Sessions are **not** touched.
- [ ] The response states that nothing was removed on the platform.

## Tests

- [ ] Failed verification writes neither row.
- [ ] Successful creation writes exactly two.
- [ ] No response body contains a secret value — assert on the serialised payload,
      not on the DTO.
- [ ] Rotation keeps `external_key` stable.
- [ ] Two projects, one installation: the second gets a domain error, not a 500.
- [ ] Archive leaves the session rows present.
- [ ] The setup declaration renders for Agenta (all empty) and Slack (all filled)
      through one code path.

## Done when

- [ ] A connection is creatable, verifiable, editable, rotatable and archivable over
      the API for a channel with credentials and one without.
- [ ] `F6` and `F47` closed with the verification recorded.

## Watch for

- **This is the package that makes Slack configurable**, months before its setup UI.
  Worth actually trying during CU-C with a real workspace — it is the cheapest
  possible early warning for wave 6.
- **`ChannelSetupField` is not a type system.** Resist adding types to it; WP22's
  discriminator already validates what is stored, and two places defining a
  credential's shape is how they drift.
