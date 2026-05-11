# Research

## Current state

### Existing Kubernetes chart

- Chart path: `hosting/helm/agenta-oss`
- Guide path: `docs/docs/self-host/guides/03-deploy-to-kubernetes.mdx`
- Current chart is OSS-specific

### General chart drift vs current runtime topology

The current Helm chart is missing workloads that now exist in Docker Compose for both OSS and EE:

- `worker-webhooks`
- `worker-events`

This is not an EE-specific issue. It is a Kubernetes chart/runtime drift issue.

### Current OSS Kubernetes validation result

Validation on `v0.95.1` found:

- the two new worker deployments render and start correctly once added to the chart
- a full OSS chart install currently hits an unrelated cron issue:
  - pod command: `supercronic /app/crontab`
  - runtime error: `Failed to fork exec: no such file or directory`

This appears to be an existing issue in the chart/image interaction rather than a consequence of the missing worker change.

### True OSS vs EE runtime differences

These will matter in PR 3:

- `AGENTA_LICENSE` is currently hardcoded to `oss` in Helm templates
- web runtime path differs:
  - OSS: `node ./oss/server.js`
  - EE: `node ./ee/server.js`
- Alembic runner differs:
  - OSS: `python -m oss.databases.postgres.migrations.runner`
  - EE: `python -m ee.databases.postgres.migrations.runner`
- bundled Postgres database names differ:
  - OSS defaults to `agenta_oss_*`
  - EE uses `agenta_ee_*`

### New Relic nuance

- OSS docker-compose GH config uses `newrelic-admin`
- EE docker-compose GH config does not use `newrelic-admin`
- EE local compose does use `newrelic-admin`

Implication: we should not blindly assume the OSS New Relic wrapper is safe for EE published images.

### Generic env/secret handling

The current chart supports a narrow set of secret categories:

- auth keys
- postgres password
- supertokens API key
- OAuth vars
- LLM provider vars

For self-hosted setups we likely need a generic extension point for optional env/secrets such as:

- access control / org management envs
- SendGrid
- Composio
- New Relic

Billing and Cloudflare Turnstile should remain unset by default for self-hosted EE.
