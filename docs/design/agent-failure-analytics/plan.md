# Agent failures in PostHog

## Goal

Send agent failures to PostHog with their reason, so the team can see what fails most and build
test cases from real failures. Delivery is best effort: the classes under "Not covered" are left
out, and a report that passes its 5 second limit loses its unsent events. Where the deployment allows it, the event also holds the
prompt that led to the failure.

## Where the capture sits

The capture sits in `RecordsWorker.process_batch`, after the records commit. It does not sit in
the runner and it does not sit in the ingest route.

| Candidate | Sees runner failures | Sees watchdog `execution_lost` | Prompt readable | Verdict |
|---|---|---|---|---|
| Runner | Yes | No | Yes | No. It needs a new PostHog client, key and identity in another service. |
| Ingest route | Yes | No, the watchdog calls `publish_record` directly | Not always committed | No |
| `RecordsWorker`, post-commit | Yes | Yes | Yes | **Chosen** |

Every failure the runner persists is already a session record, so no new wire field is needed.
`durable_events_from_records` already gives the worker this shape: a pure function turns records
into events, and the worker publishes them. Failures follow the same shape.

`ToolsRouter.call_tool` gets no capture. Its failures come back to the runner and land as a
`tool_result`, so a second capture would count them twice.

## Failure list

| `failure_source` | Record | Codes |
|---|---|---|
| `tool` | `tool_result` with `isError` and without `denied` | None. `tool_kind` is `platform`, `mcp` or `other`. |
| `mcp_server` | `mcp_server_failed` | `reasonCode`, for example `handshake_unreachable` |
| `sandbox` | `error` | `sandbox_capacity`, `sandbox_gone`, `credential_delivery_failed` |
| `model` | `error` | `provider_error`, `upstream_error`, `upstream_rejected`, `rate_limited`, `model_unavailable`, `output_limit_exceeded` |
| `harness` | `error` | `harness_init_timeout`, `subscription_login_required`, `subscription_login_refreshed` |
| `time_limit` | `error` | `tool_call_time_limit`, `run_idle_time_limit`, `run_first_response_time_limit`, `run_total_time_limit`, `turn_time_limit_reached` |
| `quota` | `error` | `starter_credits_*`, `wallet_balance_exhausted`, `concurrent_turns_limit`, `builtin_models_not_enabled`, `policy_denied` |
| `access` | `error` | `access_denied` |
| `platform` | `error` | `execution_lost`, `runner_capacity`, `turn_index_taken`, `session_records_incomplete` |
| `runner` | `error` | `runner_error`, `internal_error`, no code, any unknown code |
| `trigger` | No record. `TriggersDispatcher` catches a rejected start. | `failure_code` of the rejection, `start_never_sent`, or `start_unconfirmed` when a gateway error leaves the start unproven. No text. |

A failed `run_tool` call is an external tool failure. `tool_integration` and `tool_action` name
the real target, for example `github` and `FIND_PULL_REQUESTS`.

These are not failures and are not sent:

- `done` with `stopReason: "cancelled"` is the user's own Stop.
- `tool_result` with `denied` is a user or policy decline.
- `done` with `stopReason: "error"` always follows an `error` record, so it would count the turn
  twice. Local data has 0 such `done` records without an `error` record.
- Quarantined records arrive after the turn ended and are not in the transcript.

## Data shape

One event, `agent_failure`, so one PostHog breakdown on `failure_source` shows every failure.

```python
class AgentFailure(BaseModel):
    record_id: UUID          # PostHog event uuid
    project_id: UUID
    session_id: str
    turn_id: Optional[str]
    occurred_at: Optional[datetime]
    source: AgentFailureSource
    code: Optional[str]
    detail_code: Optional[str]  # the gateway's own refusal code
    retryable: Optional[bool]
    settled_by: Optional[str]
    tool_call_id: Optional[str]
    tool_name: Optional[str]
    tool_kind: Optional[str]
    tool_integration: Optional[str]
    tool_action: Optional[str]
    server_name: Optional[str]
    http_status: Optional[int]
    message: Optional[str]   # detail only
    prompt: Optional[str]    # detail only
```

`_SOURCE_BY_CODE` is one table from code to source. An unknown code falls back to `runner`, so a
new runner code still reaches PostHog.

## Flow

1. `process_batch` commits the batch.
2. After the watch publish, the worker calls `AgentFailureReporter.report(...)` with the visible
   records. The call never raises, so it cannot re-drive the append.
3. `failure_from_record` picks the failures. Most batches have none and stop here.
4. For each failing turn, one DAO read returns the turn's `tool_call` records and the session's
   user messages. The tool name and the prompt come from that read.
5. The reporter reads `session_streams.owner_user_id`, then the user's email, and calls
   `posthog.capture`.

## Decisions from the self-review

- **Self-hosted privacy.** `PostHogConfig` has a built-in key, and the example env files set
  Agenta keys, so a self-hosted stack sends to Agenta's PostHog by default. Prompts and tool error
  text must never leave that way. `env.posthog.enabled` and `api_key_configured` cannot detect
  this. So events go out only under `is_ee()`, and `message` and `prompt` go out only when
  `POSTHOG_AGENT_FAILURE_DETAILS=true`. Cloud must set that variable.
- **Secrets.** The runner redacts records at the persist sink, so the capture reads redacted text.
  `prompt` is cut to 4000 characters and `message` to 1000.
- **Redelivery.** The worker can see a record twice. The event `uuid` is the `record_id` and the
  `timestamp` is the record time, so PostHog treats a repeat as the same event. This also needs the same `distinct_id`. A session
  whose owner changes between deliveries counts twice, and this case is rare enough to accept.
- **Prompt on a resumed turn.** Locally 772 of 864 failing turns hold their own user message. The
  other 92 are continuations. The prompt then falls back to the latest user message before the
  failure.
- **Bounded wait.** The worker waits on the report before it acknowledges a batch, and the reads have
  no timeout of their own. Each report stops after 5 seconds and loses its unsent events.
- **Read cost.** `get_records` loads the whole session, with tool output. A new narrow DAO read
  loads only what the event needs.
- **Identity.** The middleware uses the email as `distinct_id`, so this does too. Local data has
  3185 of 3206 sessions with an owner. Without one, `distinct_id` is `project:<id>` and the event
  sets `$process_person_profile: false`.
- **Repeated MCP events.** The runner replays `mcp_server_failed` on every turn while the server
  stays down, so PostHog counts turns affected, not outages.
- **Tool name.** Local data matches 937 of 937 failed `tool_result` records to a `tool_call`.
  Pi drops the `mcp__agenta-tools__` prefix, so `tool_kind` is `other` for those calls.

## Not covered

- Admission refusals (`session_turn_in_use`, `session_admission_rejected`). The runner does not
  persist them, and its own comments say they are not run failures.
- Pi's own MCP connect failures. They stay in an operator log until a tool call fails.
- Trigger failures that end as a 400 delivery. They are setup errors, not run failures.
- Sandbox teardown failures. They do not affect the run and stay in runner logs.

## Files

- `api/oss/src/core/sessions/records/failures.py`: shape, table, pure functions.
- `api/oss/src/tasks/asyncio/sessions/failure_reporter.py`: reads context, sends the event.
- `api/oss/src/core/sessions/records/interfaces.py`, `api/oss/src/dbs/postgres/sessions/records/dao.py`: narrow read.
- `api/oss/src/tasks/asyncio/sessions/records_worker.py`, `api/entrypoints/worker_streams.py`: wiring.
- `api/oss/src/tasks/asyncio/triggers/dispatcher.py`, `api/entrypoints/routers.py`, `api/entrypoints/worker_queues.py`: the `trigger` capture.
- `api/oss/src/utils/env.py`, `hosting/docker-compose/ee/env.ee.*.example`: the detail flag.
- `api/oss/tests/pytest/unit/sessions/test_agent_failures.py`: tests.
