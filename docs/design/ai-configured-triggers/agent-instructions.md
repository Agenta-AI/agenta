# Agent instructions (drafts for `static_catalog.py` / `build_kit.py`)

The builder agent's authoritative surface is the backend op catalog (`api/oss/src/core/workflows/build_kit.py`) plus prose in `static_catalog.py` — not runner-local skill files (research.md §6). This doc drafts both: op descriptions and the guidance prose. Wording should be reconciled with the op-catalog revisions in `docs/design/trigger-latest-binding/` before landing.

## 1. Op descriptions (build_kit)

| op | description (draft) |
|---|---|
| `create_webhook_subscription` | Create an event trigger fed by an inbound webhook. Provide `recipe_key` (from `discover_triggers` / the webhook catalog; use `custom` for unlisted systems), a short `event_description`, optional initial `filter`/`transform`, and `references` binding the run target. Returns the ingress URL, verification scheme, and registration mode. Never returns secret values. |
| `register_webhook_upstream` | Register the subscription's ingress URL on the provider side (only for recipes with `registration: api`, e.g. GitHub, Telegram, Stripe). Requires a vaulted credential slug — if none exists, call `request_secret` first. Registration happens server-side; you will not see the credential. |
| `request_secret` | Ask the user for a secret (bot token, API key). Takes `name`, `description`, `kind` — **no value parameter**. The user enters the value in a secure form outside this conversation; you receive only a vault `slug` to pass to other ops. NEVER ask the user to paste a secret into the chat. |
| `update_trigger_transform` | Update the subscription's `filter` (boolean expression: deliver only when true), `transform` (expression mapping the raw payload to the run's `inputs_fields`), and/or `dedupe_key`. |
| `list_trigger_deliveries` | List recent deliveries for a subscription, including verification failures, filter-dropped events, transform errors, raw payload, and transformed inputs. Your primary debugging surface. |
| `replay_delivery` | Re-run a stored delivery's raw payload through the subscription's current filter/transform. Use `dry_run: true` to inspect the result without dispatching a run. |

## 2. Guidance prose (static_catalog)

> ### Choosing a trigger mechanism
> - Run on a clock → `create_schedule` (no discovery needed).
> - React to an outside event with a **ready Composio connection and a matching event** in `discover_triggers` → `create_subscription` (managed path).
> - React to an outside event otherwise — provider not covered, self-hosted without Composio, or a custom/internal system → `create_webhook_subscription` (webhook path). Check the webhook catalog for a recipe first; fall back to `recipe_key: custom`.
>
> ### Configuring a webhook trigger (the loop)
> 1. **Create** the subscription from the best-matching recipe. Read the returned ingress URL, scheme, and registration mode.
> 2. **Register** upstream. `registration: api` → call `register_webhook_upstream` (call `request_secret` first if no credential slug exists). `registration: manual` → tell the user to paste the ingress URL into the provider's dashboard; the UI shows them the URL and any secret — do not read or repeat secret values.
> 3. **Write the transform** using the recipe's `transform_hints` and the target's input schema. Keep the filter narrow (e.g. GitHub: `action = "opened"`) so unrelated events don't start runs.
> 4. **Test with a real event.** Trigger one (GitHub sends `ping` on hook creation; Telegram: ask the user to message the bot; Stripe: a test-mode event) and read `list_trigger_deliveries`.
> 5. **Iterate.** On verification failure: re-check scheme/registration — do not weaken verification to `none` to make errors go away. On filter-drop or transform error or schema mismatch: fix the expression with `update_trigger_transform`, then `replay_delivery` (`dry_run: true`) against the stored payload until the output matches the run's input schema. Re-test live once dry-run passes.
> 6. **Confirm** to the user with the trigger name, the event it fires on, and one example of the mapped inputs — never with secret material.
>
> ### Secrets — hard rules
> - Never ask the user to paste tokens, API keys, or signing secrets into the conversation. Always use `request_secret`.
> - Never echo, log, or store secret values; ops accept and return vault slugs only.
> - If the user pastes a secret into the chat unprompted: do not repeat it, tell them it should be rotated since it entered the transcript, and direct them to the secure form via `request_secret`.
>
> ### Caveats worth knowing
> - Telegram allows **one webhook URL per bot** — creating this trigger repoints the bot; confirm with the user if the bot may already be in use.
> - Stripe returns the endpoint signing secret only at creation; `register_webhook_upstream` vaults it automatically — never ask the user for it.
> - Slack Events API performs a URL-verification handshake; the platform answers it automatically — a `url_verification` delivery is expected and is not an error.
> - Ack semantics: the platform returns 2xx to providers immediately; processing failures appear in deliveries, not as provider-side retries.

## 3. What we deliberately do NOT instruct

- No per-provider payload documentation in the prose — recipes carry `transform_hints`, and the agent's own knowledge plus the replay loop covers the rest. Keeping prose short follows the house finding that over-prescriptive instructions reduce output quality.
- No instruction to compose raw HTTP against provider APIs for registration — that path is server-side by design (secrets).
