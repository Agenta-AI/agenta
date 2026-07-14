# Context

## The current architecture

The agent runner is a long-lived Node service. Services sends it a run request, the runner chooses a sandbox provider, and a sandbox-agent daemon launches the selected harness.

~~~text
Services API
  -> runner HTTP service
       -> sandbox provider: local or Daytona
            -> sandbox-agent daemon
                 -> harness: Pi or Claude
~~~

The two choices are independent:

- The harness belongs to the agent configuration.
- The sandbox provider belongs to the run, with a deployment default.

One runner process can therefore execute Pi locally, Claude locally, Pi in Daytona, and Claude in Daytona. We do not need separate deployment services for those combinations. Additional runner replicas are a scaling and ownership concern, not a harness-selection requirement.

## Why the current setup is hard to explain

Configuration grew in several directions at once:

- The backend locates the runner with `AGENTA_RUNNER_INTERNAL_URL`.
- The runner defaults a sandbox with `SANDBOX_AGENT_PROVIDER`.
- Daytona uses ambient `DAYTONA_*` variables shared with code evaluation.
- Agent-only overrides such as `DAYTONA_SNAPSHOT_AGENT` sit beside shared defaults.
- `AGENTA_AGENT_SANDBOX_PI_INSTALLED` asks the operator to describe a runtime fact that the runner can detect.
- `AGENTA_SESSION_HARNESS_MOUNTS` exposes an internal implementation choice as a deployment policy.
- Self-managed Pi authentication causes the runner to discover its own Pi login and upload it into Daytona.
- The API, Services, runner, and browser each carry pieces of provider availability.

This makes a Compose file look like several partially overlapping products. An operator cannot tell which variables are read by the runner, which belong to the code evaluator, which describe policy, and which are only workarounds for one snapshot.

## The live failure that exposed the boundary

The local deployment on port 8280 had two runner-like services:

- the normal Compose runner, which had the Daytona API key;
- a subscription sidecar, which held local harness login state but had no Daytona API key.

Services was pointed at the subscription sidecar. A request that selected Daytona reached that runner and failed with:

~~~text
Authentication credentials not found. Set DAYTONA_API_KEY, or both
DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.
~~~

Nothing was wrong with the user's Daytona account. The request reached a runner deployment that was not configured for Daytona. The setup made it easy to split capabilities accidentally.

The target local QA deployment is one trusted development runner with both providers enabled and explicit read-write local subscription mounts. This is a development convenience, not a production multi-tenant topology. A local harness shares the runner container and can inspect other same-user processes through `/proc`.

## Trust boundaries

### Local provider

The daemon and harness are child processes inside the runner container. The working directory is a starting directory, not a confinement boundary. The harness can read files and environment visible to the container user.

Consequences:

- The runner container must receive only secrets that a local harness is allowed to reach.
- Helm must not inject database, auth, cryptographic, or bucket-wide store credentials into the runner.
- Subscription files mounted into the runner are available to trusted local agents. This is opt-in and single-tenant.

### Daytona provider

The runner stays in the deployment. The daemon and harness execute in a Daytona sandbox. Only material the runner explicitly sends should cross that boundary:

- the resolved model credential for the run;
- workspace and instruction files;
- scoped durable-mount credentials;
- explicitly configured runtime files;
- runner-owned support binaries and configuration.

The runner's Daytona organization credential provisions the sandbox. It is infrastructure control-plane material and must never enter the sandbox environment.

## Product principles

### Configuration describes intent

Operators configure facts they own: enabled providers, a default, credentials, lifecycle values, and mounted subscription inputs. The runner detects runtime facts such as whether Pi is already installed.

### One owner per value

A Daytona API key used to provision agent sandboxes belongs to the runner. A Daytona key used by code evaluation belongs to the code evaluator. A shared ambient variable is not a simplification when the two consumers have different images, snapshots, permissions, and lifecycles.

### Explicit data movement

The runner should never infer that a missing model API key means "copy whatever login I happen to have." Runtime authentication is a declared mode, and subscription state is a declared deployment mount.

### Fail before side effects

Unknown providers, disabled providers, missing provider credentials, and contradictory defaults fail at startup or before sandbox creation. There is no silent provider fallback. Mount behavior stays best-effort in version 1, with a structured warning on durable-to-ephemeral degradation (the fail-loud contract is RSH-11).

### Pre-production cleanup

These configuration surfaces are not a stable public API. The implementation should remove obsolete variables directly instead of carrying aliases, deprecation branches, or insecure compatibility modes.
