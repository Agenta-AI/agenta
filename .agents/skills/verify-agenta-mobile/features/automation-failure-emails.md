# Automation failure emails

When an automation starts failing, the people who own it get one email. The run history shows how each run ended. A cron job calls `POST /admin/triggers/deliveries/settle` every minute, so every result takes up to two minutes to appear.

## Sub-features

- `outcome` sets the run dot and label: green completed, red failed, `Cancelled`, `Waiting for a person`.
- `one-email` sends one email per failure streak. Later failures update the open notification and send nothing.
- `resolve` closes the notification on a healthy run, an edit of an active automation, a start, or a delete. A stop and a rename of a stopped automation keep it open.
- `reasons` covers `runner_error`, `execution_lost`, `start_failed`, `paused_*` and `agent_needs_setup`.
- `switch` records the notification and marks the delivery `skipped` when `AGENTA_NOTIFICATIONS_EMAIL_ENABLED=false`.

## How to get to it (user POV)

- `Automations`, then the automation, then `Run history`. URL `{base}/automations/{id}?view=runs`.
- The email goes to the automation's creator, else the project owners and admins, else the organization owner.

## Driving it with the browser pane

The pane in the Claude desktop app holds the signed-in app and Gmail. Use it here, because Gmail is the proof. Hidden-pane limits do not affect this feature.

Preconditions:

- The API must report a provider. `env.sendgrid.enabled` needs `SENDGRID_API_KEY` and a verified sender in `SENDGRID_FROM_EMAIL` in the gitignored `.env.ee.dev`.
- The cron image bakes in `triggers.txt`. After a change to it, run `docker compose -p agenta-ee-dev --env-file hosting/docker-compose/ee/.env.ee.dev -f hosting/docker-compose/ee/docker-compose.dev.yml build .api`, then `up -d --no-deps api cron`.
- A failure older than 1 hour opens nothing, so test with fresh runs.

Run a real automation soon:

- A schedule may run at most every 15 minutes. A daily cron for the next minute passes that rule, for example `51 13 * * *`.
- For a streak, add `AGENTA_TRIGGERS_SCHEDULE_MIN_INTERVAL_MINUTES=1` to the env file, recreate `api`, and create `* * * * *` through the API, because the web form keeps its own floor. Remove the line afterwards. Each run spends real model money.

Force each result on a throwaway automation:

| Result | How |
|---|---|
| `failed`, `runner_error` | Commit `llm.model = "claude-does-not-exist-9"` on the agent. |
| `completed`, resolve | Commit the real model back. |
| `failed`, `execution_lost` | `docker stop agenta-ee-dev-runner-1` during a run. |
| `500`, `start_failed` | Keep the runner stopped for the next run, then `docker start` it. |
| `422`, `agent_needs_setup` | Commit `llm = {provider: "openai", model: "gpt-4o"}` on a Claude harness agent. |
| `403`, `paused_missing_principal` | Set `principal_kind` and `principal_id` to null on the schedule. Also set `created_by_id` to a random id to prove the fallback recipient. |

In the app tab, call the API with `fetch("http://localhost/api/...?project_id=...", {credentials: "include"})`. Revisions commit through `/workflows/revisions/commit`, schedules through `/triggers/schedules/`.

Read state with `scripts/automation-state.sh <project-id>`. In Gmail, search `from:account@hello.agenta.ai "is failing" newer_than:1d`, and read the body from `div.a3s`.

## Gotchas

- Proof needs three parts: the run row, the `notifications` row, and the email itself.
- A run that started before a fix and failed after it opens a new notification and sends an email. This is known limit 1, not a bug.
- `Run now` does not write a trigger delivery.
- A Claude agent moves `sleep` to the background, so a live Stop is hard to time. The cancelled and waiting labels need a run that lasts, or a marked fixture.
- A dev overlay `AbortError` on navigation comes from the dev server. Press Escape.
- Restore the agent's config and delete test automations afterwards. Remove any env line you added.
