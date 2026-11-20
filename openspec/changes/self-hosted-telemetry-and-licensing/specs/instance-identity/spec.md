# Instance identity

## Purpose

Give every self-hosted instance one stable, random id, so Agenta can count instances and group their events, without using anything that identifies a person or a host.

## ADDED Requirements

### Requirement: One instance id per database
Agenta SHALL store one random UUID version 4 as the instance id in the `instances` table. The migration that creates the table SHALL insert that row, and every later start SHALL reuse it. The id SHALL NOT be derived from a hostname, an IP address, an email or a secret, and SHALL NOT be set by a setting. All API, cron and worker containers that share one database SHALL report the same id.

#### Scenario: Upgrade or first install
- **WHEN** the migrations run against a database with no `instances` row
- **THEN** the migration SHALL insert one row with a new random id

#### Scenario: Restart or new replica
- **WHEN** a container starts and the row exists
- **THEN** Agenta SHALL use the stored id and SHALL NOT create a new one

#### Scenario: Database reset
- **WHEN** the operator starts Agenta against a new, empty database
- **THEN** Agenta SHALL have a new instance id, and the old instance SHALL stop sending heartbeats

### Requirement: Development instances are marked
Every event that carries the instance id, except the install ping, SHALL also carry `instance_kind`. Agenta SHALL set it to `ci` when the `CI` environment variable is set, to `development` when the host of `AGENTA_WEB_URL` is `localhost`, `127.0.0.1` or a private network address, and to `production` otherwise. The URL itself SHALL NOT be sent.

#### Scenario: Local developer stack
- **WHEN** a developer runs Agenta on `http://localhost`
- **THEN** its events SHALL carry `instance_kind: "development"` so instance counts can leave it out

### Requirement: Instance counts
Agenta's PostHog project SHALL be able to answer three counts from these events alone: instances ever installed (distinct ids on the install ping), active instances (distinct ids with a heartbeat in the last 7 days), and silent instances (installed, never or no longer sending a heartbeat). Active instances SHALL be filterable by `instance_kind`, edition and version from the heartbeat. Installed and silent instances carry only the id, so they SHALL NOT be split further.

#### Scenario: Instance with telemetry off
- **WHEN** an instance has `AGENTA_TELEMETRY_ENABLED=false`
- **THEN** it SHALL still appear in "installed" (from the install ping) and SHALL count as silent
