<!-- review-loop: design=2b344f758d73 lenses=simplify,naming -->

**Review loop result** for the Teams channel design (repo commit `ce68eea1af` on main), 2 rounds.

| Lens | Final rating |
| --- | --- |
| Simplify | Low |
| Naming | Low |

Round 1: simplify Low (Codex); naming High (Codex) and Medium (Opus). Round 2: simplify Low, naming Low (Codex).

**Fixed:**
- The app id has one stored form, the bare GUID `app_id`. One helper maps the wire forms (`28:<app_id>` in `recipient.id` and mentions, and the three audience forms) to it.
- A names table fixes the field names in each layer: `app_id`, `client_secret` (a new secret field, separate from WhatsApp's `app_secret`), `tenant_id`, `conversation_id`, `thread_id`, `service_url`, `message_id`, `title`, and the reused `webhook_url`.
- `conversation_id` is the Teams conversation id without `;messageid=`, with one split and join helper pair.
- The app package travels in the setup document as `format: "zip"` with base64 content, decoded by one UI helper.
- The three tokens have three names: inbound JWT, access token, choice token.
- The manifest version is a constant that changes only with the template or icons, and the manifest id is derived from `app_id`.
- Install and uninstall events are ignored and never deactivate the connection.

**Left on purpose:** nothing.
