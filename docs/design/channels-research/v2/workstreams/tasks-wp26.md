# WP26 — tasks

Spec: [specs-wp26.md](specs-wp26.md). Design: `journeys.md` §2.1, `provisioning.md`.

First package of the wave. Nothing branches from it until it merges at M1.

## Read first

- [ ] Confirm what already exists rather than rebuilding it: `build_slack_manifest`,
      `SlackAdapter.build_setup_document`, `SlackAdapter.verify_connection`,
      `ChannelSetup`/`ChannelSetupField`, Slack's declared `setup` block, and
      `ChannelsService.create_connection`'s verify-then-store order.
- [ ] Confirm the Channels settings tab is a permanent tab and not flag-gated. The
      throwaway probe surface is a different page and stays that way.

## The route that is missing

- [ ] A per-**channel** setup route beside the per-connection one, taking a channel
      name and composing the request URL the same way the existing handler does.
- [ ] `operation_id` and `response_model` per the house conventions — the id becomes
      the generated SDK method name, so it is API surface.
- [ ] `EDIT_CHANNELS` on it, matching its sibling.
- [ ] Leave the per-connection route alone. It shows drift for an existing
      connection, and WP29 gives it a second job.
- [ ] Regenerate the API client and fix every consumer the regeneration breaks. Do
      not hand-edit generated files.

## The screens

- [ ] A section on the Channels settings tab: *Add Slack → Use your own Slack app*.
- [ ] Show the manifest as copyable text, and as a link that pre-fills Slack's
      create-from-manifest form.
- [ ] State the request URL plainly, and say that a local deployment needs a tunnel
      because Slack cannot reach a laptop.
- [ ] Render the paste form **from `setup.fields`** — name, label, password box,
      required. Do not hand-write the three inputs.
- [ ] Render `setup.instructions` as the numbered steps. They are already written.
- [ ] Save posts the values as `credentials` to the existing create route.
- [ ] Show the service's error verbatim on a failed verification, and keep the form
      filled so nothing is retyped.

## Tests

- [ ] **Unit** — the per-channel route returns a document for a channel that
      declares one, and an empty document for a channel that does not, with no
      connection in existence.
- [ ] **Unit** — the form renders from a declaration fixture, not from three
      hardcoded names. Two password boxes, three required.
- [ ] **Integration** — a failing `auth.test` leaves no connection row and no secret
      row. Read both tables after the attempt.
- [ ] `pnpm lint-fix` in `web/`; `ruff format` then `ruff check --fix` in `api/`.

## Done when

- [ ] An operator with no connection reaches the manifest and copies it.
- [ ] Three pasted values produce a verified connection, credential in the vault,
      nothing sensitive on the connection row.
- [ ] A wrong token leaves nothing behind and shows Slack's reason.

## Watch for

- **The declaration must render something.** If the form is hand-written, the
  declaration has no consumer and becomes decorative, which is the shape this
  project keeps finding.
- **`api_app_id` is a locator, not a secret.** The credential DTO ignores unknown
  keys silently, so routing it to the vault makes it vanish with no error.
- **Do not touch `SlackAdapter`.** WP27 owns the only adapter change this wave, and
  two packages editing it in parallel is the collision the merge points exist to
  prevent.
