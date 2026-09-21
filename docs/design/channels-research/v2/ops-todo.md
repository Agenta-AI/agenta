# Channels ops to-do (things a person must set up, not code)

This list holds the operational tasks that code alone cannot do. Keep it updated as we
add platforms and ship to more environments.

## Slack (hosted, Agenta-owned app)
- [ ] Create the Agenta Slack app from the manifest in `adapters/slack/manifest.py`.
- [ ] Record the app's Client ID, Client Secret, and Signing Secret.
- [ ] Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` on each
      deployment that should offer the hosted app (QA stack first, then staging, then
      production). Without all three, the one-click install is hidden, by design.
- [ ] Set the Slack app's redirect URL to `<api_url>/channels/catalog/channels/slack/callback/`.
- [ ] Set the Slack app's event request URL to `<public_url>/api/channels/slack/events/`.
- [ ] Test the one-click install round trip on the QA stack.

## Telegram (hosted, Agenta-owned bot)
- [ ] Create the Agenta Telegram bot with @BotFather. Record the bot token.
- [ ] Decide the bot username (the handle users see, for example @AgentaBot).
- [ ] Set the bot token as a deployment secret (name to be defined with the code).
- [ ] Set the bot's webhook to `<public_url>/api/channels/telegram/events/...` after deploy.
- [ ] Decide the bot privacy mode with @BotFather (on = mention-only in groups).
- [ ] Test the QR and deep-link account-link flow on the QA stack.

## Feature flag and deployment
- [ ] Make the channels feature flag durable in the web image. Today the QA stack
      carries a container-local patch that a full image rebuild would lose. The real
      fix is to bake the flag line into the web image entrypoint or add it to the base
      compose env. (Backend flag is `AGENTA_CHANNELS_ENABLED`; web flag is
      `NEXT_PUBLIC_AGENTA_CHANNELS_ENABLED`.)
- [ ] Decide per-environment rollout: which stages get channels on, and when.

## Public URLs and tunnels
- [ ] Confirm a stable public URL for each environment's ingress, since Slack and
      Telegram both call back to a fixed URL. The QA stack uses a reserved ngrok tunnel.

## Notes
- QA stack today: project `channels-qa`, tunnel
  `https://subangular-groundlessly-bryn.ngrok-free.dev`, both mobile gates turned off so
  the desktop app is reachable.
