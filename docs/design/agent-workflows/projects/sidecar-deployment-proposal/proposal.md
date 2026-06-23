# Agent runner deployment proposal

Status: revised proposal for review. Updated 2026-06-20 after owner review.

Goal: make `services/agent` a first-class `sandbox-agent` runner service across
Agenta deployments. The service should be part of the normal OSS and EE deployment
shape, like the API, services, web, and workers. Advanced operators can still point
Agenta at an external runner, but the default self-host story should not require them
to invent this component.

This document is a deployment and naming plan. It includes the env-var handling changes
needed to make the deployment contract real.

---

## 1. Decision summary

1. **The deployable service is `sandbox-agent`.** Stop using the old service and env
   names that tie the runner to Pi. The Compose service, Helm objects, Railway service,
   docs, comments, and examples should all call it `sandbox-agent` or "agent runner".

2. **The production runner is sandbox-agent-backed.** The direct in-process Pi runner was
   useful as a POC and can remain as an internal/example path, but it should not be the
   default production image or deployment story.

3. **The Agenta service only needs a runner URL.** The services/API container should call a
   stable HTTP runner contract. Runtime engine choice is not an Agenta deployment env var.
   Harness choice belongs to agent/run configuration. Sandbox/provider details belong to
   the runner service.

4. **The default Compose stack includes the runner.** OSS and EE Docker Compose should ship
   a default `sandbox-agent` service that backs the open-source agent workflow path. It can
   be replaced by an external runner for advanced deployments, but the base stack should be
   usable without an extra optional overlay.

5. **Auth/provider selection is owned by the provider-model-auth design.** This proposal
   should not design OAuth, account binding, or provider-key injection. It should link to
   `provider-model-auth/` and keep the runner deployment contract compatible with
   self-managed credentials.

6. **Cloud and self-host sandbox images have different distribution rules.** Agenta Cloud
   can maintain its own internal Daytona snapshot. Self-hosters get a build recipe and
   container templates, not a redistributed snapshot that contains proprietary harnesses.

---

## 2. Current state to clean up

The active stack has a TypeScript runner at `services/agent`. It exposes:

- `GET /health`
- `POST /run`
- an NDJSON streaming form of the same run contract

The Python services layer calls that runner over HTTP when a runner URL is configured, or
spawns the local TypeScript CLI when running from a source checkout.

Current deployment gaps:

| Target | Current state | Target state |
| --- | --- | --- |
| EE dev Compose | Has a runner service, but with legacy Pi-specific naming and dev-only mounts. | Rename to `sandbox-agent`, keep dev conveniences isolated to dev. |
| OSS dev Compose | No runner service. | Add the same first-class `sandbox-agent` service. |
| OSS/EE production Compose | No runner service. | Add `sandbox-agent` to the default production Compose files. |
| Helm | No runner Deployment or Service. | Add first-class runner templates and service URL wiring. |
| Railway | `hosting/railway/oss/` exists for the core stack, but no runner service. | Add a Railway `sandbox-agent` service and configure the services URL. |
| Docs | Self-host docs do not describe the runner or its env contract. | Add a runner guide and update configuration and architecture pages. |
| CI images | Production Dockerfile exists, but no published runner image. | Publish a GHCR image for OSS and the corresponding private EE image if needed. |

Current naming debt:

- The runner service and URL env var still use Pi-specific names in code and Compose.
- The ACP-backed engine still uses older library/product wording in comments, filenames,
  env vars, and docs.
- Several dev-only defaults are mixed into the sample runner block.

Those names should be treated as migration debt. New documentation and new deployment
surface should use the target vocabulary.

---

## 3. Target architecture

Default containerized deployment:

```text
browser / playground
    |
    v
services container
    agent workflow handler
    resolves config, provider access, tools, trace context
    |
    | POST /run to AGENTA_AGENT_RUNNER_URL
    v
sandbox-agent runner service
    services/agent HTTP server on :8765
    owns the agent loop and sandbox-agent daemon lifecycle
    |
    +-- local sandbox-agent provider
    |
    +-- Daytona sandbox-agent provider
          |
          +-- harness adapter: Pi, Claude Code, future Codex/OpenCode/etc.
```

Ownership boundary:

| Layer | Owns | Must not own |
| --- | --- | --- |
| Agenta services/API | Workflow routing, agent config, provider-account resolution, tool resolution, trace context, run history. | Sandbox implementation details, harness installation, runner process lifecycle. |
| `sandbox-agent` runner service | The `/run` protocol, harness launch, sandbox-agent daemon lifecycle, sandbox provider config, runner-side tracing export. | Agenta project vault, all stack secrets, browser-callable secret APIs. |
| Sandbox image/snapshot | Harness binaries, adapter dependencies, OS packages, optional self-managed login volume. | Baked Agenta credentials or user secrets. |

The direct in-process Pi runner should move out of the production path. Keep it only as:

- a local development shortcut,
- a unit-test/fake-engine helper, or
- an example of how to build a custom runner.

The published runner image should exercise the same sandbox-agent-backed path users deploy.

---

## 4. Configuration contract

### 4a. Services/API container

The Agenta services container should have a small deployment contract:

| Var | Default | Meaning |
| --- | --- | --- |
| `AGENTA_AGENT_RUNNER_URL` | `http://sandbox-agent:8765` in Compose/Helm/Railway | HTTP URL for the runner service. |
| `AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS` | implementation default | Request timeout for a runner call. |
| `AGENTA_AGENT_ENABLE_MCP` | `false` until the runtime support is complete | Feature gate for user-declared MCP server resolution. |

Remove these concerns from the services env surface:

- runtime engine choice,
- default harness choice,
- sandbox provider choice,
- Daytona credentials,
- harness-specific auth directories,
- runner image or snapshot selection.

Harness selection should come from the agent/run config. Sandbox defaults should be owned
by the runner service and eventually by the persisted agent template, not by the services
container env.

The new env vars should be added to `api/oss/src/utils/env.py` or the services equivalent
instead of being read through raw `os.getenv`.

### 4b. `sandbox-agent` runner service

The runner service should have a runner-scoped env contract:

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | HTTP listen port. |
| `SANDBOX_AGENT_PROVIDER` | `local` | Default sandbox provider for runs that do not request one. Supported values begin with `local` and `daytona`. |
| `SANDBOX_AGENT_BIN` | bundled binary | Override path to the sandbox-agent daemon binary. |
| `SANDBOX_AGENT_LOG_LEVEL` | `info` or implementation default | Runner and daemon log verbosity. |
| `SANDBOX_AGENT_DAYTONA_API_KEY` | unset | Daytona API key, only needed when the Daytona provider is enabled. |
| `SANDBOX_AGENT_DAYTONA_API_URL` | Daytona default | Daytona API endpoint. |
| `SANDBOX_AGENT_DAYTONA_TARGET` | Daytona default | Daytona region/target. |
| `SANDBOX_AGENT_DAYTONA_SNAPSHOT` | unset | Snapshot name for Daytona runs. |
| `SANDBOX_AGENT_DAYTONA_IMAGE` | unset | Plain image override for Daytona runs when no snapshot is set. |

Rules:

- Do not use `env_file` for the runner in Compose. The runner must not inherit the full
  Agenta stack secret set.
- Do not expose provider API keys as a default runner env path. Managed provider access
  comes from the service-side resolver described in `provider-model-auth/`.
- Do not keep `AGENTA_HOST` or `AGENTA_API_KEY` as published runner defaults. Trace export
  credentials should be supplied per run or through a narrowly scoped runner setting.
- Keep harness-specific filesystem knobs out of the main table. They belong in templates for
  users building their own runner image or self-managed auth setup.

### 4c. Template-only harness config

Some variables are valid for a custom image template but should not define the general
runner contract:

| Template var | Use |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Self-managed Claude Code login mounted by an individual self-hoster. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Self-managed Claude Code OAuth path when an operator explicitly opts into it. |
| `PI_CODING_AGENT_DIR` | Pi login directory for a Pi-specific custom image or dev setup. |
| provider API key env vars | Local-only or BYO-runner fallback, not the Agenta-managed multi-tenant path. |

The docs should present these as custom-image recipes, not as the normal Agenta deployment
contract. The account and credential model is in `provider-model-auth/design.md`.

---

## 5. Runner protocol and external runners

"Bring your own runner" cannot mean "any container with two endpoints." The `/run`
contract carries tools, trace context, model/provider access, permission policy, MCP
configuration, skills, streaming events, and capability flags.

Before we document external runners as supported, we need:

1. A versioned runner protocol identifier.
2. JSON schemas or generated types for request, event, and response payloads.
3. Golden fixtures shared between Python and TypeScript.
4. A conformance test that a custom runner image can run.
5. Capability negotiation so the service can reject unsupported harness/tool combinations
   before a run starts.

Until that exists, the supported self-host path is:

- run the Agenta-published `sandbox-agent` image, or
- build a custom image from our template while preserving the same protocol.

---

## 6. Deployment plan

### 6a. Docker Compose

Add `sandbox-agent` as a first-class service to OSS and EE Compose files, including dev and
production variants.

Target shape:

```yaml
services:
  services:
    environment:
      AGENTA_AGENT_RUNNER_URL: ${AGENTA_AGENT_RUNNER_URL:-http://sandbox-agent:8765}

  sandbox-agent:
    image: ghcr.io/agenta-ai/agenta-sandbox-agent:${AGENTA_VERSION}
    restart: always
    environment:
      PORT: "8765"
      SANDBOX_AGENT_PROVIDER: ${SANDBOX_AGENT_PROVIDER:-local}
      SANDBOX_AGENT_DAYTONA_API_KEY: ${SANDBOX_AGENT_DAYTONA_API_KEY:-}
      SANDBOX_AGENT_DAYTONA_API_URL: ${SANDBOX_AGENT_DAYTONA_API_URL:-}
      SANDBOX_AGENT_DAYTONA_TARGET: ${SANDBOX_AGENT_DAYTONA_TARGET:-}
      SANDBOX_AGENT_DAYTONA_SNAPSHOT: ${SANDBOX_AGENT_DAYTONA_SNAPSHOT:-}
      SANDBOX_AGENT_DAYTONA_IMAGE: ${SANDBOX_AGENT_DAYTONA_IMAGE:-}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8765/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    networks:
      - agenta-network
```

Dev-only differences can stay in `docker-compose.dev.yml`:

- local build from `services/agent/docker/Dockerfile.dev`,
- source bind mounts,
- watcher or extension rebuild commands,
- local login mounts for a developer's machine.

Published production Compose files should not include:

- host-specific Agenta URLs,
- user home-directory mounts,
- dev-box IPs,
- whole-stack `env_file` inheritance,
- direct-Pi POC defaults.

External runner path:

- Set `AGENTA_AGENT_RUNNER_URL` to the external service URL.
- Either omit the internal `sandbox-agent` service through a documented advanced override or
  let it run unused if the deployment tool cannot conditionally remove it cleanly.

### 6b. Helm

Add a first-class runner Deployment and Service:

- `templates/sandbox-agent-deployment.yaml`
- `templates/sandbox-agent-service.yaml`
- helper for the runner image
- image pull secrets wired for EE/private registries
- services-pod env injection for `AGENTA_AGENT_RUNNER_URL`

Proposed values:

```yaml
agentRunner:
  enabled: true
  externalUrl: ""
  image:
    repository: ""
    tag: ""
    pullPolicy: IfNotPresent
  sandbox:
    provider: local
    daytona:
      apiKeySecret: ""
      apiUrl: ""
      target: ""
      snapshot: ""
      image: ""
  env: {}
  resources: {}
```

Rules:

- If `agentRunner.enabled=true`, set `AGENTA_AGENT_RUNNER_URL` to the in-cluster Service.
- If `agentRunner.externalUrl` is set, point services at that URL and do not require the
  in-cluster runner.
- Keep existing SDK code-sandbox Daytona values separate from runner Daytona values. They
  are different consumers.

### 6c. Railway

Railway has an existing OSS deployment tree under `hosting/railway/oss/`. Add a
`sandbox-agent` service there:

- `hosting/railway/oss/sandbox-agent/Dockerfile` or image-backed deployment config.
- Bootstrap/configure scripts create the Railway service.
- The services Railway service gets `AGENTA_AGENT_RUNNER_URL` set to the private Railway URL
  for `sandbox-agent`.
- For Daytona runs, set the runner-scoped Daytona vars on the `sandbox-agent` Railway
  service.

Railway caveats:

- Railway has no Docker socket or host volume in the normal template flow.
- For self-managed OAuth/login mounts, prefer a custom self-host container environment
  rather than Railway.
- For remote sandbox execution, Daytona is the cleaner Railway path.

---

## 7. Image and sandbox strategy

### 7a. Published runner image

Add CI that builds `services/agent/docker/Dockerfile` and publishes:

- OSS: `ghcr.io/agenta-ai/agenta-sandbox-agent`
- EE/private, if required by the release process: matching private registry image

The image should:

- run the sandbox-agent-backed path by default,
- listen on `$PORT`,
- expose `/health` and `/run`,
- bake no credentials,
- avoid proprietary harness binaries unless redistribution is explicitly allowed,
- include only the open-source dependencies and adapters needed for the default path.

The image should not be a direct-Pi POC container.

### 7b. Custom runner templates

Provide templates for operators who need a customized runner:

- add Claude Code from Anthropic at build or runtime,
- add future Codex/OpenCode adapters,
- install internal CA certificates,
- preinstall MCP servers,
- mount self-managed login directories,
- pin harness versions.

The template contract is still the same: listen on `$PORT`, implement the versioned runner
protocol, and bake no credentials.

### 7c. Daytona images and snapshots

Separate the two cases:

- **Agenta Cloud:** can maintain an internal Daytona snapshot for the cloud runner path,
  including the harness binaries Agenta is licensed to use internally.
- **Self-host:** ship a recipe that builds a snapshot in the operator's Daytona account.
  Do not distribute the built snapshot.

Move the snapshot builder out of historical scratch material into a supported path, for
example:

```text
services/agent/sandbox-images/daytona/
```

That folder should include:

- a build script,
- a README explaining prerequisites,
- provenance notes for each harness installed,
- required runner env vars,
- validation commands.

---

## 8. Provider, model, and auth boundary

Do not solve provider/model/auth in this deployment proposal. The accepted design lives in:

- `docs/design/agent-workflows/provider-model-auth/context.md`
- `docs/design/agent-workflows/provider-model-auth/design.md`

Deployment implications from that design:

- The committed agent config carries model intent, not concrete credentials.
- The run/environment chooses a provider account or self-managed runtime mode.
- The service resolves a least-privilege credential plan.
- The runner receives only the credential material required for that run.
- Self-managed OAuth/login directories are a runtime-provided auth mode, not a vault-stored
  mutable file.

The runner deployment must preserve that boundary by avoiding broad env inheritance and by
keeping credential-bearing env vars out of the default service config.

---

## 9. Documentation plan

Docs live under `docs/docs/self-host/`.

1. **New: `guides/07-deploy-the-agent-runner.mdx`**
   - What the `sandbox-agent` runner is.
   - How it fits into Compose, Helm, and Railway.
   - Default deployment path.
   - External runner URL path.
   - Health checks and troubleshooting.

2. **New: `guides/08-custom-agent-runner-images.mdx`**
   - How to extend the runner image.
   - Template-only harness config.
   - Self-managed login mounts.
   - Licensing and "no baked credentials" rules.

3. **New: `guides/09-agent-daytona-sandboxes.mdx`**
   - When to use Daytona.
   - How to build the self-host snapshot recipe.
   - How Cloud-owned snapshots differ from self-host recipes.

4. **Edit: `02-configuration.mdx`**
   - Add the services env vars.
   - Add runner-scoped env vars.
   - Avoid listing template-only OAuth/login vars as normal Agenta config.

5. **Edit: `infrastructure/01-architecture.mdx`**
   - Add the `sandbox-agent` runner service to the deployment diagram.
   - Show `services -> sandbox-agent` over the runner URL.

6. **Edit: `guides/04-deploy-on-railway.mdx`**
   - Add the `sandbox-agent` Railway service.
   - Explain private service URL wiring.

7. **Edit existing agent-workflows design docs**
   - Replace legacy runner names in current docs and comments.
   - Keep archived `trash/` pages historical unless a current page links to them as active
     design truth.

---

## 10. Implementation phases

### Phase 0 - Terminology cleanup

- Pick final names:
  - service: `sandbox-agent`
  - services env: `AGENTA_AGENT_RUNNER_URL`
  - image: `agenta-sandbox-agent`
  - Helm values root: `agentRunner`
- Rename current docs and comments away from legacy runner wording.
- Drop the old env names from current docs and examples. No compatibility note is needed
  because this surface has not shipped.

### Phase 1 - Runner URL and config cleanup

- Add `AGENTA_AGENT_RUNNER_URL` to the env module.
- Keep the old URL env as a temporary fallback with deprecation logging.
- Remove deployment env defaults for runtime, harness, and sandbox from the services layer.
- Move sandbox-provider defaults into runner service config.

### Phase 2 - Production runner path

- Make the sandbox-agent-backed engine the default runner path.
- Move the direct Pi POC path out of the published image or gate it as dev/example only.
- Ensure unit and wire-contract tests cover the production path.

### Phase 3 - Compose

- Add `sandbox-agent` to OSS and EE dev/prod Compose.
- Wire `AGENTA_AGENT_RUNNER_URL` into services.
- Remove dev-only defaults from published Compose files.
- Add health checks.

### Phase 4 - Images and CI

- Publish the OSS runner image to GHCR.
- Add any EE/private image publishing required by the release process.
- Document image tags and release ownership.

### Phase 5 - Helm and Railway

- Add Helm templates, values, services env wiring, and private image pull support. 
- Add `sandbox-agent` to `hosting/railway/oss/` scripts and docs.

### Phase 6 - Docs and custom templates

- Add self-host guides.
- Move Daytona snapshot recipes into `services/agent/sandbox-images/daytona/`.
- Add custom runner image templates and conformance checks.

---

## 11. Open decisions

1. **Final env name:** this proposal recommends `AGENTA_AGENT_RUNNER_URL`.
2. **Final image name:** this proposal recommends `agenta-sandbox-agent`.
3. **Direct Pi POC destination:** move it to an example after the sandbox-agent path is
   stable.
4. **Helm default:** this proposal recommends `agentRunner.enabled=true` for first-class
   behavior, with `externalUrl` and disable paths for advanced operators. 
5. **Cloud Daytona snapshot ownership:** decide where the internal Cloud snapshot build and
   release process lives.
6. **External runner support level:** decide whether v1 supports only "custom image from our
   template" or a broader protocol-compatible external runner after conformance tests exist.
