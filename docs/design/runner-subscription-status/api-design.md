# API design

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Design rule

The runner owns the local file check. The Python agent service owns the public response. The
frontend only receives status values.

## Runner endpoint

Add an authenticated endpoint:

```http
GET /subscription-status
Authorization: Bearer <runner-token>
```

Proposed runner response:

```json
{
  "version": 1,
  "harnesses": {
    "codex": {
      "state": "ready",
      "provider": "openai"
    },
    "pi_core": {
      "state": "not_configured"
    },
    "claude": {
      "state": "login_unusable",
      "provider": "anthropic"
    }
  }
}
```

Allowed `state` values:

| State | Meaning |
| --- | --- |
| `ready` | The mount variable is set. The expected login file exists and passes a local shape check. |
| `not_configured` | The runner has no mount variable for this harness. |
| `login_missing` | The mount is configured, but the expected login file does not exist. |
| `login_unusable` | The file is empty, unreadable, or does not have the minimum expected shape. |
| `unsupported` | This runner version cannot check this harness. |

The endpoint must not return:

- Environment variable values.
- File paths.
- Tokens or token prefixes.
- Account names or email addresses.
- Subscription plan names.
- Raw file or parse errors.

The runner must require its shared token for this endpoint. Do not add this information to the
public `/health` response.

## Agent service endpoint

Add a public endpoint on the Python agent service:

```http
POST /runtime/subscription-status
```

Proposed request for the current deployment-wide runner:

```json
{
  "harness": "codex"
}
```

When Agenta Cloud adds per-user runner connections, the request must use a server-owned reference:

```json
{
  "harness": "codex",
  "runner_connection_id": "019d952f-0000-0000-0000-000000000000"
}
```

The endpoint must not accept a runner URL from the browser. The server resolves the connection ID
to the private URL and runner token. The status request and model run must use the same resolver.

The agent service calls the runner endpoint with `AGENTA_RUNNER_INTERNAL_URL` and
`AGENTA_RUNNER_TOKEN`.

Proposed public response:

```json
{
  "runner": "connected",
  "checked_at": "2026-08-12T12:00:00Z",
  "harnesses": {
    "codex": {
      "state": "ready",
      "provider": "openai"
    }
  }
}
```

Allowed `runner` values:

| State | Meaning |
| --- | --- |
| `connected` | The service received a valid response from the runner. |
| `unavailable` | The service has no runner URL, cannot contact the runner, or receives an invalid response. |
| `incompatible` | The runner is active but does not support this endpoint or response version. |

The agent service must return HTTP 200 for these three operational states. This lets the frontend
show a setup state without treating an inactive local runner as an application error. Authentication
and permission failures still use normal HTTP error codes.

The response is deployment state. It is not project data. The public route must still require an
authenticated Agenta user. The implementation must apply the same access rule that protects agent
configuration reads.

## Frontend query

Add a frontend API function for `POST /runtime/subscription-status`. Use a schema check at the API
boundary.

Add a TanStack Query atom with these initial rules:

- Query only when the user selects `self_managed`.
- Cache for 10 seconds.
- Refresh every 15 seconds while the subscription card is visible.
- Refresh when the browser window becomes active.
- Do not persist the result in IndexedDB or local storage.
- Provide a manual **Check again** action.

The dynamic query must remain separate from `harnessCatalogQueryAtom`. The catalog answers what a
harness supports. The new query answers what this runner can use now.

## Frontend display

`ProviderCredentialsSection` receives the status for the selected harness. The card shows one main
message:

| Runner and harness state | User message |
| --- | --- |
| Loading | `Checking the runner…` |
| `connected` and `ready` | `Subscription login found` |
| `connected` and `not_configured` | `Runner found. Subscription folder is not configured.` |
| `connected` and `login_missing` | `Runner found. Login file is missing.` |
| `connected` and `login_unusable` | `Runner found. Login file cannot be used.` |
| `unavailable` | `Runner is not connected.` |
| `incompatible` | `Update the runner to check subscription status.` |
| Query error | `Agenta could not check the runner.` |

The card keeps the setup documentation link. It adds **Check again**. It does not say that a
subscription is verified. A file check cannot verify provider access.

## Complete data path

```text
1. User selects Subscription.
2. ProviderCredentialsSection requests the runtime status atom.
3. The atom calls the frontend API function.
4. The frontend sends POST /runtime/subscription-status to the Python agent service.
5. The agent service sends GET /subscription-status to the runner.
6. The agent service authenticates with the private runner token.
7. The runner checks only the login location for each installed harness.
8. The runner returns status values to the agent service.
9. The agent service validates and sanitizes the response.
10. The frontend validates the public response.
11. ProviderCredentialsSection selects the current harness and shows its state.
```

## Open interface decisions

1. Decide whether the public route belongs on the Python agent service or the main FastAPI API.
   The Python agent service is the shorter path because it already calls the runner. The main API
   is easier for the frontend to consume through the generated client.
2. Decide the permission for the public route. It must match an existing read permission.
3. Decide whether Pi can report one provider login or multiple provider logins. Pi can use more
   than one provider, so a later response can use a provider map if the first version needs it.
4. Decide whether the first release supports only the deployment runner. Per-user Agenta Cloud
   runners require a runner connection resource and a shared server-side resolver first.
