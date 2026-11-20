<!-- review-loop: design=4300022be5da lenses=simplify,naming -->

**Review loop result** for the Teams channel design (repo commit `ce68eea1af` on main), 3 rounds.

| Lens | Final rating |
| --- | --- |
| Simplify | Low |
| Naming | Low |

Rounds 1 and 2 reviewed the proposal. Round 3 reviewed this OpenSpec change. Round 1: simplify Low (Codex); naming High (Codex) and Medium (Opus). Round 2: both Low (Codex). Round 3: both Low (Codex).

**Fixed:**
- The app id has one stored form, the bare GUID `app_id`. One helper maps the wire forms (`28:<app_id>` in `recipient.id` and mentions, and the three audience forms) to it.
- A names table fixes the field names in each layer: `app_id`, `client_secret` (a new secret field, separate from WhatsApp's `app_secret`), `tenant_id`, `conversation_id`, `thread_id`, `service_url`, `message_id`, `title`, and the reused `webhook_url`.
- `conversation_id` is the Teams conversation id without `;messageid=`, with one split and join helper pair.
- The app package travels in the setup document as `format: "zip"` with base64 content, decoded by one UI helper.
- The three tokens have three names: inbound JWT, access token, choice token.
- The manifest version is a constant that changes only with the template or icons, and the manifest id is derived from `app_id`.
- Install and uninstall events are ignored and never deactivate the connection.

**Left on purpose:**
- The app name comes from the connection name, not a fixed "Agenta". A fixed name would show every agent as an app named "Agenta" in Teams. A rename after install does not reach Teams; the design states this as a known v1 limit.
