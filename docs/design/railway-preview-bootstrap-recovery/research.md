# Codebase Findings

## Bootstrap creates a fixed preview topology

`bootstrap.sh` creates 13 Railway services: `gateway`, `web`, `api`,
`services`, `runner`, `worker-streams`, `worker-queues`, `cron`, `alembic`,
`supertokens`, `Postgres`, `redis`, and `seaweedfs`. It creates persistent
volumes for `Postgres`, `redis`, and `seaweedfs`.

The original `add_service` helpers redirected each `railway add` error and
returned success. That behavior allowed bootstrap to continue after a failed
service creation request.

## Railway status can provide the required confirmation

The Railway CLI returns the linked project's environments and service
instances through `railway status --json`. The bootstrap script already
requires `jq`, so it can extract service names without adding a dependency.

Railway can expose a newly created service shortly after the add command
returns. A bounded status check gives Railway time to show that service before
bootstrap marks the environment incomplete.

## Configure identifies the later symptom

`configure.sh` applies variables one service at a time. When Railway reports
that a service does not exist, the script currently returns a generic failure.
It can add recovery guidance at this point without changing its command-line
interface or the variable update flow.

## Design Decisions

- Query Railway state before adding a service, then verify all required
  services after provisioning.
- Keep an `add` failure visible. Do not retry it automatically.
- Treat a failed add as unresolved until final status confirms whether Railway
  created the service.
- Verify services before creating their volumes so an incomplete environment
  fails at the earliest reliable point.
