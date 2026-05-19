# n8n self-hosted — tracing spike

Verifies how n8n's native OpenTelemetry export behaves when an AI/LLM
node executes inside a workflow.

n8n added first-party OTel support via the `N8N_OTEL_*` env vars (and
the standard `OTEL_*` env vars). This spike points it at Agenta's OTLP
endpoint and runs a one-node "OpenAI Chat Model" workflow.

## What's in here

| File | Purpose |
|---|---|
| `docker-compose.yml` | Self-hosted n8n with `N8N_OTEL_ENABLED=true` pointed at Agenta |
| `.env` | Credentials (copied from neighbouring spike apps) — `AGENTA_*`, `OPENAI_API_KEY`. `AGENTA_HOST` uses `host.docker.internal` to reach the host's Agenta from inside the container |
| `workflow.json` | Importable n8n workflow: Manual Trigger → OpenAI Chat Model |
| `EMPIRICAL_FINDINGS.md` | What we observed when running the spike |

## Run

```bash
cd web/examples/n8n-self-hosted
docker compose up
```

Then open `http://localhost:5678`, import `workflow.json`, paste an
OpenAI API key into the OpenAI credential, and click "Execute workflow".

Watch the container logs — you should see `[OTel] tracing enabled` and
OTLP exporter activity when the workflow runs.

## Why we're testing this

The Agenta TypeScript SDK proposal (`docs/design/ts-sdk/`) asks whether
v1 needs n8n-specific code or whether n8n users get tracing "for free"
via n8n's own OTel support pointed at Agenta. The empirical answer is
in [EMPIRICAL_FINDINGS.md](./EMPIRICAL_FINDINGS.md).
