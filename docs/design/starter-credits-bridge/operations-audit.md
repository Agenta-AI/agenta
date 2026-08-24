# Configure starter credits in an EE environment

This page lists only the configuration that an environment owner must provide before the
starter-credits bridge can be enabled. It does not cover release QA, deployment commands, browser
testing, or agent credentials.

Never put a database URI, master key, salt, service-account JSON, or webhook URL in Git, a pull
request, or chat. Store them in the environment's AWS Secrets Manager secret.

## Where to put the values

Cloud deployments read one AWS Secrets Manager secret named `<stage>.env`:

| Environment     | Secret name                             | Gateway hostname                     |
| --------------- | --------------------------------------- | ------------------------------------ |
| Preview testing | `testing.env`                           | `gateway.testing.preview.agenta.dev` |
| Preview demo    | `demo.env`                              | `gateway.demo.preview.agenta.dev`    |
| Preview staging | `staging.env`                           | `gateway.staging.preview.agenta.dev` |
| Cloud live EU   | `live.env` in the EU account and region | `gateway.<TRAEFIK_DOMAIN>`           |
| Cloud live US   | `live.env` in the US account and region | `gateway.<TRAEFIK_DOMAIN>`           |

Preview secrets are in the preview AWS account in `eu-central-1`. In the AWS console, switch to
that account and region, open **Secrets Manager**, select the stage secret, choose **Retrieve
secret value**, and edit the env-file text. Preserve every unrelated existing line.

Live uses a separate `live.env` secret in each deployment account and region. Updating EU does
not update US.

For live environments, read `TRAEFIK_DOMAIN` from that environment before creating DNS. Do not
copy a preview hostname into a live secret.

Each environment needs its own database, salt, master key, provider identity, webhook, and
program team. Do not copy those values between environments.

## Values to set before the first deployment

### Application and bridge values

| Variable                                            | What it is                                                                    | Value                                                                                          | Where to get it                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTA_SERVICES_INTERNAL_KEY`                      | Shared proof used when the API calls the services container                   | Keep the existing value. If the environment has none, generate one with `openssl rand -hex 32` | Generate it once. Store the same value for the API and services. Do not send it to the web app, runner, workers, migrations, or sandboxes |
| `AGENTA_STARTER_CREDITS_BRIDGE_ENABLED`             | Switch that allows signup to seed a funded connection                         | `false` for the first deployment; `true` after the team id is stored                           | Set this directly in the environment secret                                                                                               |
| `AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID`             | LiteLLM team that owns all starter-credit keys and enforces the total ceiling | Empty for the first deployment                                                                 | Do not invent it. The first deployment creates the proxy; the team is created afterward and its returned id is stored here                |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_PUBLIC_URL`    | Public inference address stored in each seeded connection                     | `https://<gateway-hostname>`                                                                   | Build it from the gateway hostname in the environment table                                                                               |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL`     | Private address used by the API to mint and block keys                        | `http://litellm-proxy:4000`                                                                    | Fixed by the internal service name                                                                                                        |
| `AGENTA_STARTER_CREDITS_BRIDGE_GATEWAY_HOST`        | Dedicated public hostname routed to inference endpoints                       | The gateway hostname from the environment table                                                | Derived from the stage name or the environment's `TRAEFIK_DOMAIN`                                                                         |
| `AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY`          | LiteLLM administrator credential used to create and block keys                | A unique value such as `sk-<random>`                                                           | Generate one unique, random, `sk-` prefixed value per environment                                                                         |
| `AGENTA_STARTER_CREDITS_BRIDGE_MODEL_ID`            | The only funded model exposed by the starter connection                       | `vertex_ai/gemini-3.6-flash`                                                                   | Fixed by the approved starter-credits design                                                                                              |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROGRAM_CEILING_USD` | Maximum total spend allowed for the environment's starter-credits program     | `500`                                                                                          | Fixed by the approved program budget. Enter it without a currency symbol                                                                  |
| `AGENTA_STARTER_CREDITS_BRIDGE_POLICY_FLAG`         | PostHog flag whose payload controls eligibility and per-account grants        | `starter-credits-bridge-policy`                                                                | The flag already exists in the Agenta Cloud PostHog project                                                                               |
| `AGENTA_STARTER_CREDITS_BRIDGE_ALERT_WEBHOOK`       | Destination for starter-credit refusal, failure, and budget alerts            | A Slack Incoming Webhook URL                                                                   | Create or select a Slack Incoming Webhook for the alert channel, then copy its URL into the environment secret                            |

`AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=false` is only a bootstrap state. The bridge cannot be
enabled on the first deployment because `AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID` does not exist
until LiteLLM is running. The final state is `ENABLED=true` with a real team id.

### LiteLLM and provider values

| Variable                     | What it is                                                           | Value                                                               | Where to get it                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URI_LITELLM`       | Connection URI for LiteLLM's persistent ledger and key database      | `postgresql://<user>:<password>@<host>:5432/<database>`             | Provision a dedicated database and role in the environment's PostgreSQL service. Use the host, database, user, and password returned by that provisioning |
| `LITELLM_SALT_KEY`           | Stable secret used by LiteLLM when encrypting stored values          | A unique random value for this environment                          | Generate once with `openssl rand -hex 32`. Never rotate it after LiteLLM has stored keys                                                                  |
| `LITELLM_VERTEX_SA_JSON_B64` | Google service-account credential used by LiteLLM to call Vertex AI  | Single-line base64 of the dedicated service-account JSON            | Download the JSON from Google Cloud IAM. Encode it with `base64 -w 0 <service-account-file>.json`, then paste the output directly into Secrets Manager    |
| `LITELLM_VERTEX_PROJECT`     | Google Cloud project billed for funded model calls                   | The project id that owns the service account and provider spend cap | Read `project_id` from the service-account JSON or from the Google Cloud project selector                                                                 |
| `LITELLM_VERTEX_LOCATION`    | Vertex AI location used for the funded model                         | `global`                                                            | Fixed for this model route                                                                                                                                |
| `POSTHOG_API_KEY`            | Project token used by the API to read the starter-credit policy flag | The project token for the **Agenta Cloud** PostHog project          | In PostHog, open the Agenta Cloud project, then Project settings, and copy the project token. This is not a PostHog personal API key                      |

The service-account identity should be dedicated to this proxy and have only the Vertex AI
permission it needs. Prefer a dedicated Google Cloud project for each environment because the
provider spend cap applies to an entire project and service, not to one service account.

Standard Gemini PayGo uses Dynamic Shared Quota, which has no configurable fixed usage limit. Use
a Cloud Billing spend-cap budget as the provider-side emergency brake. The LiteLLM team ceiling
remains the precise program and per-key limit.

## External setup outside Secrets Manager

### PostHog

Use the **Agenta Cloud** PostHog project for EE cloud environments. The
`starter-credits-bridge-policy` flag already exists there. Confirm that it is enabled and that its
payload contains these fields and current approved values:

```json
{
  "global_daily": 50,
  "global_hourly": 15,
  "work_domain_daily": 10,
  "freemail_domains": [],
  "block_digit_locals": true,
  "grant_usd": 5,
  "key_max_parallel_requests": 2,
  "key_rpm_limit": 30,
  "key_tpm_limit": 200000
}
```

An empty `freemail_domains` list does not remove the built-in provider list. The application always
adds its built-in list and treats values in the payload as additions.

You need two different PostHog values:

- `AGENTA_STARTER_CREDITS_BRIDGE_POLICY_FLAG` is the public name of the flag. Its fixed value is
  `starter-credits-bridge-policy`.
- `POSTHOG_API_KEY` is the project token that lets this deployment read flags from the correct
  PostHog project. Copy it from the Agenta Cloud project's settings.

### Google Cloud

For each environment:

1. Select or create the Google Cloud project that will pay for starter-credit calls. Use a
   dedicated project if other workloads use Agent Platform or Vertex AI.
2. Create a dedicated service account for the LiteLLM proxy.
3. Grant only the Vertex AI inference permissions it needs.
4. Confirm the Gemini model is available in the selected project.
5. Download one JSON key, base64-encode it, and store the result as
   `LITELLM_VERTEX_SA_JSON_B64`.
6. Store the JSON `project_id` as `LITELLM_VERTEX_PROJECT`.
7. In **Cloud Billing > Budgets & alerts**, create a [**Spend cap enforcement** budget](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).
8. Scope it to one project and **Agent Platform (formerly Vertex AI)**, then choose a monthly
   target below the maximum provider bill the program owner accepts.

A spend cap pauses new requests after estimated gross cost reaches the target. Enforcement is not
instant, in-flight requests still finish, and the cap resets monthly. It complements the LiteLLM
lifetime team ceiling; it does not replace it.

Do not place the service-account JSON in the repository or in an application container.

### Database

Create a persistent PostgreSQL database and dedicated role for LiteLLM in each environment. This
database is separate from Agenta's application database. Its data must survive application
blue-green deployments.

Build `POSTGRES_URI_LITELLM` from the returned database name, hostname, username, and password.
The URI must start with `postgresql://`, not `postgres://`.

### DNS and certificate

Create a DNS record for the environment's gateway hostname and point it at that environment's load
balancer. Add the same hostname to the environment's TLS certificate. Do both before setting the
public URL to that hostname.

For staging, the required name is:

```text
gateway.staging.preview.agenta.dev
```

### Slack alert destination

Choose a channel that the team actually watches. Create a Slack Incoming Webhook for that channel
and store the complete webhook URL as `AGENTA_STARTER_CREDITS_BRIDGE_ALERT_WEBHOOK`. The URL is a
secret even though it looks like an ordinary link.

When environments share the same alert destination, keep one operator-only copy in
`~/.agenta-starter-litellm/shared-alerting.env` with file mode `0600`. Each environment still
receives the value through its own Secrets Manager secret.

## Staging values

Put this first block in AWS Secrets Manager secret `staging.env` before the first proxy deployment:

```dotenv
AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=false
AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID=
AGENTA_STARTER_CREDITS_BRIDGE_PROXY_PUBLIC_URL=https://gateway.staging.preview.agenta.dev
AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL=http://litellm-proxy:4000
AGENTA_STARTER_CREDITS_BRIDGE_GATEWAY_HOST=gateway.staging.preview.agenta.dev
AGENTA_STARTER_CREDITS_BRIDGE_MODEL_ID=vertex_ai/gemini-3.6-flash
AGENTA_STARTER_CREDITS_BRIDGE_PROGRAM_CEILING_USD=500
AGENTA_STARTER_CREDITS_BRIDGE_POLICY_FLAG=starter-credits-bridge-policy
LITELLM_VERTEX_PROJECT=agenta-416316
LITELLM_VERTEX_LOCATION=global
```

Also set these secret values in `staging.env`:

```dotenv
AGENTA_SERVICES_INTERNAL_KEY=<existing-value-or-new-random-value>
AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY=<generated-sk-value>
AGENTA_STARTER_CREDITS_BRIDGE_ALERT_WEBHOOK=<slack-incoming-webhook-url>
POSTGRES_URI_LITELLM=<dedicated-staging-postgres-uri>
LITELLM_SALT_KEY=<stable-random-value>
LITELLM_VERTEX_SA_JSON_B64=<single-line-base64-service-account-json>
POSTHOG_API_KEY=<agenta-cloud-posthog-project-token>
```

Current staging setup state on 2026-08-24:

| Item                                                  | Current state                          | What you need to do                                                                    |
| ----------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Dedicated LiteLLM database and `POSTGRES_URI_LITELLM` | Set                                    | Nothing unless the credential was rotated                                              |
| `LITELLM_SALT_KEY`                                    | Set                                    | Never rotate it after keys exist                                                       |
| `LITELLM_VERTEX_SA_JSON_B64`                          | Set and verified for `agenta-416316`   | Nothing                                                                                |
| `AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY`            | Set                                    | Never share it with another environment                                                |
| `AGENTA_STARTER_CREDITS_BRIDGE_ALERT_WEBHOOK`         | Set                                    | Reusable operator copy is in `~/.agenta-starter-litellm/shared-alerting.env`           |
| PostHog policy flag                                   | Enabled with the approved payload      | Nothing unless the program policy changes                                              |
| `POSTHOG_API_KEY`                                     | Matches the Agenta Cloud project token | Nothing                                                                                |
| Gateway DNS and certificate                           | Missing                                | Create and cover `gateway.staging.preview.agenta.dev`                                  |
| Agent Platform spend cap                              | Not configured or not verified         | Create a Cloud Billing spend-cap budget for project `agenta-416316` and Agent Platform |

## After the first deployment

The deployment operator creates one LiteLLM program team after the proxy is healthy. That team uses
the same `500` USD ceiling as `AGENTA_STARTER_CREDITS_BRIDGE_PROGRAM_CEILING_USD` and has no reset
period.

When the operator gives you the returned team id, update the same environment secret:

```dotenv
AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID=<returned-team-id>
AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=true
```

Those are the final values. A second deployment then enables starter-credit seeding.

Do not create a second team when retrying. Reuse the existing team id so the environment keeps one
total spending ceiling.

## Repeat for every EE environment

For `testing.env`, `demo.env`, and each regional `live.env`, repeat the same setup with that
environment's own:

- internal service key;
- gateway hostname and certificate;
- master key and permanent salt;
- LiteLLM database and role;
- Google service account, project, and Agent Platform spend cap;
- Slack webhook;
- PostHog project token;
- LiteLLM team id.

The admin URL, model id, policy flag name, Vertex location, and approved policy payload stay the
same unless the program owner explicitly changes the design.
