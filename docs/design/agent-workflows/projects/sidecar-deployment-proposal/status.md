# Status

## Current State

Implementation complete for the repo surfaces covered by the proposal. The flat proposal
has been moved into this folder as `proposal.md`, and Agenta now treats `sandbox-agent` as
the first-class deployable runner service reached through `AGENTA_AGENT_RUNNER_URL`.

## Progress Log

- Moved the flat proposal file into this folder as
  `docs/design/agent-workflows/sidecar-deployment-proposal/proposal.md`.
- Added this `status.md` and a folder `README.md`.
- Updated the services/API handler to route through the TypeScript runner URL and removed
  the deploy-time harness/sandbox/runtime env selection.
- Renamed the SDK and runner adapter surfaces from upstream-specific names to
  `sandbox-agent` names while keeping the direct Pi engine as an explicit local/dev path.
- Wired the `sandbox-agent` service through OSS and EE Docker Compose variants, Helm,
  Railway scripts, and the image build workflow.
- Added self-hosting docs for deploying the runner, building custom runner images, and
  using Daytona-backed sandboxes.
- Swept active docs and deployment references for stale runner names and old env vars.

## Decisions

- Use `sandbox-agent` for the deployable service name.
- Use `AGENTA_AGENT_RUNNER_URL` for the services/API container URL to the runner.
- Move the direct in-process Pi path toward an example/dev path, not the production default.
- No compatibility note for old env names is required because this surface has not shipped.
- Keep runner-provider defaults runner-side under `SANDBOX_AGENT_*`.
- Keep the Daytona snapshot recipe under `services/agent/sandbox-images/daytona/`.
- Use `agenta-sandbox-pi` as the default Daytona snapshot name.

## Blockers

- None.

## Open Questions

- EE private runner image publishing still needs to be verified in the release pipeline.
- A full self-host smoke deploy should run after the `agenta-sandbox-agent` image is
  published by CI.

## Next Steps

1. Run an OSS Compose smoke deploy from published images.
2. Run a Helm install smoke deploy with the default `agentRunner.enabled=true` path.
3. Verify the Railway preview path creates and wires the `sandbox-agent` service.
