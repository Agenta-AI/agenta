# Documentation plan

Agenta is an agent studio. Agents are the product a person self-hosts Agenta to run, not a
feature bolted onto a platform. The self-host section is structured around that fact: agent
execution is a first-class area next to deployment and access control, not a subfolder.

The pages land with the phase 1 rename PR. They depend only on the final variable names in
[interface.md](./interface.md). Troubleshooting notes whose error text comes from later phases
land as that code lands.

Each page is one Diátaxis type. A reader who wants to learn, to do a task, to look up a value,
or to understand a model reaches a page written for exactly that need.

## Target sidebar

```
Self-host
├─ Overview                              (explanation: what you self-host, editions, license scope)
├─ Get started
│  ├─ Quick start                        (tutorial: self-host locally with Docker, end to end)
│  └─ Use your own subscription          (tutorial: local Pi / Claude / Codex login)
├─ Agent execution
│  ├─ How agents run                     (explanation: runner topology, harness and sandbox axes)
│  ├─ Sandbox isolation and security     (explanation: local is not a boundary; posture switch)
│  ├─ Run agents in a cloud sandbox (Daytona)  (how-to)
│  ├─ Customize the agent runtime        (how-to)
│  └─ Runner and sandbox configuration   (reference)
├─ Deploy to production
│  ├─ Deploy on a remote server
│  ├─ Set up SSL
│  ├─ Deploy on Kubernetes
│  └─ Deploy on Railway
├─ Access control
│  ├─ Configure SSO
│  ├─ Restrict organization creation
│  └─ Dynamic access controls
├─ Architecture
│  ├─ System architecture
│  └─ Networking
├─ Configuration reference               (all environment variables)
├─ Upgrade and migrate
│  ├─ Upgrade Agenta
│  ├─ Enable the runner and store
│  ├─ Multi-organization migration
│  ├─ OSS to EE
│  └─ v0.100.3 migration
└─ FAQ
```

## Structure decisions

These are the calls where the shape was open. Each states the option chosen and why.

- **Agent execution is a top-level group, not an `agents/` subfolder.** Agents are the reason
  most readers self-host, so their concepts, how-tos, and reference sit alongside deployment and
  access control at the same level.
- **The runner reference is its own page inside Agent execution, not a section of the main
  configuration page.** Option A was a section of the configuration reference; option B a
  dedicated page. The runner surface (routing, providers, Daytona, lifecycle, callbacks) is large
  enough to stand alone, and it belongs next to the agent concepts a reader is already on. The
  main configuration page keeps a one-line pointer.
- **Security and trust is its own concept page, not a warning box or an FAQ entry.** It is the
  first question a self-hosting community asks. A dedicated concept page answers it once; the
  how-tos link to it instead of repeating warnings.
- **Cloud sandbox how-tos are one page per provider, with the provider in the title.** Today that
  is Daytona. When E2B or another cloud arrives, it becomes a sibling page in the same group. No
  existing page is renamed. The local-versus-cloud axis lives in the two concept pages above.
- **Troubleshooting is distributed, not a single page.** Each how-to and the runner reference end
  with a short symptom-cause-check section keyed to the structured errors they cause. A reader
  hits the fix on the page they are already reading.
- **"Use your own subscription" is a tutorial in Get started, next to Quick start.** These two are
  the only self-host tutorials: set the platform up, then opt into a personal subscription. The
  page links forward to the Agent execution concepts for context.
- **Dynamic access controls moves next to SSO and organization restriction.** All three answer
  "who can use this deployment and as what," so they form one group.
- **No "run your first agent" tutorial and no "connect an external runner" how-to.** Running an
  agent is product usage and belongs in the product docs. Relocating the whole runner is not a
  supported self-host path.

## Get started

### Quick start (tutorial)

Keep the existing quick start as the end-to-end local setup path: prerequisites, a clean OSS
Compose stack on port 80 or a custom port, first login, and the upgrade pointer. Add one line at
the end that points to the Agent execution overview for readers who want to know where agent code
runs. This page is the "self-host locally" tutorial. It does not teach product usage.

### Use your own subscription (tutorial)

The opt-in path for a trusted personal deployment. Covers the three supported logins by name: Pi
login, Claude Code OAuth, and the ChatGPT/Codex login.

1. Find the supported login state for the harness on the operator's machine.
2. Add the read-only volume mount in the Compose file and point the harness config variable at it.
3. Run a self-managed agent and confirm it uses the mounted login.
4. Remove the mount and confirm the run fails with the explicit missing-configuration error.

Safety callouts: one personal subscription serves one operator, not every user of a shared
deployment; local agents can read files visible to the runner container; Daytona does not support
this by design. Link the isolation claim to the security concept page.

## Agent execution

### How agents run (explanation)

Build the mental model that six partial pages tell today. Explain:

- Services calls one runner service.
- Harness and sandbox provider are independent axes. One runner can serve local and Daytona runs
  at the same time.
- Sandboxes are where agent code runs. Today that is the local runner container or a Daytona cloud
  sandbox. Other clouds are future providers on the same axis.
- Managed model keys are per-run data. Runner provider credentials are deployment infrastructure.
- Session, agent, and transcript mounts give runs different persistence. A run with no session and
  no workflow artifact is the only ephemeral case.

No full variable table and no copy-paste deployment recipe. Link to the runner reference and the
Daytona how-to.

### Sandbox isolation and security (explanation)

Answer the trust question directly:

- Local runs share the runner container. They are not an isolation boundary. They are a
  convenience for a single trusted operator.
- Daytona runs cross an explicit file and credential boundary. Use Daytona when a deployment is
  multi-user or exposed.
- The enabled-provider list is the posture switch. A deployment that enables `daytona` only lets
  no user code reach the runner's process environment.
- What crosses into a Daytona sandbox and what never does: managed model keys cross; the runner's
  Daytona credential and any personal subscription mount never do.
- A personal subscription mount is single-tenant by definition.

### Run agents in a cloud sandbox (Daytona) (how-to)

Configure remote sandbox execution with managed model credentials.

Cover: the Daytona API key; enabling `local,daytona` or Daytona alone; choosing the default; the
`AGENTA_RUNNER_DAYTONA_*` variables; snapshot versus image; the snapshot build recipe in
`services/runner/sandbox-images/daytona/`; public reachability for durable storage; a smoke test.
Branch on the unsupported combinations (a personal subscription on Daytona) with the exact error.
Do not reuse code-evaluator Daytona variables. Do not describe one snapshot serving both the
runner and the code evaluator. End with a short troubleshooting section.

### Customize the agent runtime (how-to)

Add binaries, certificates, and dependencies (for example chromium or the gh CLI). Fix the scope
confusion in the page it replaces: a reader who wants extra tools inside agent runs needs the
sandbox image or snapshot, not the runner service image.

Cover three mechanisms, ordered by what readers ask for most:

- Extra dependencies for Daytona runs: build a custom snapshot with the shipped scripts.
- Extra dependencies for local runs and a pinned runner build: build a custom runner service image
  from `services/runner/docker/Dockerfile.gh`.
- Extra project folders for local runs: an operator-owned Compose volume mount.

### Runner and sandbox configuration (reference)

Exact names, types, defaults, readers, secret classification, and conflicts. Generate or check the
table against the typed runner configuration schema so it cannot drift.

Group by: Services-to-runner routing; runner server; enabled and default sandbox providers (note
that the API reads the same value); Daytona; session lifecycle and warm sessions; callback API;
intentionally internal debug settings.

Each variable states: semantic role; consumer; default; whether empty is valid; whether it is
secret; Compose location; Helm values path; conflicts and startup validation. End with the
symptom-cause-check troubleshooting entries: requested provider disabled; runner unreachable or
unauthorized; missing local subscription mount; remote subscription unsupported; snapshot or
harness missing; Daytona authentication error; store unreachable from Daytona; mount degradation
warning. Copy error text from the shipped structured errors. Add entries whose errors land in
later phases as that code lands.

## Existing page dispositions

New URLs are preserved with `slug` where a page only changes folder, so bookmarks keep working.
Deleted and genuinely renamed pages get redirects (next section).

| Page | Disposition |
|---|---|
| 01-quick-start | KEEP as the Quick start tutorial. Add a pointer to the Agent execution overview. |
| 02-configuration | TOUCH. Replace the agent-runner and agent-Daytona sections with a pointer to the runner reference. Keep the code-evaluator `daytona` section but fix its cross-reference to the removed shared snapshot. Delete the "Slice 1 / Slice 2" roadmap language. |
| 03-upgrading | MOVE into Upgrade and migrate as "Upgrade Agenta". Content unchanged. |
| 04-dynamic-access-controls | MOVE into Access control. Content unchanged. |
| 99-faq | TOUCH. Move the "which options are community projects" answer to the Overview; keep version-pinning and image questions. |
| guides/01-deploy-remotely | MOVE into Deploy to production. Content unchanged. |
| guides/02-using-ssl | MOVE into Deploy to production. Content unchanged. |
| guides/03-deploy-to-kubernetes | MOVE into Deploy to production and TOUCH. Fix the "What gets deployed" list to include the runner and store and the consolidated worker pair. |
| guides/04-deploy-on-railway | MOVE into Deploy to production and TOUCH. Rename the two stale variables in its runner table. Fix its worker list. |
| guides/05-configure-sso | MOVE into Access control. Fix the one deprecated variable (`SUPERTOKENS_EMAIL_DISABLED` to `AGENTA_ACCESS_EMAIL_DISABLED`). |
| guides/06-restrict-organization-creation | MOVE into Access control. Content unchanged. |
| guides/07-deploy-the-agent-runner | DELETE. Per-platform snippets move to the runner reference; the topology narrative moves to How agents run. The external-runner stub is dropped, not migrated. Redirect to How agents run. |
| guides/08-custom-agent-runner-images | DELETE. Superseded by Customize the agent runtime. Redirect there. |
| guides/09-agent-daytona-sandboxes | DELETE. Superseded by the Daytona how-to and the runner reference. Drop the archived-sandbox changelog prose. Redirect to the Daytona how-to. |
| infrastructure/01-architecture | MOVE into Architecture and TOUCH. Slim the runner subsection to a link to How agents run. Fix the stale variable in the sandbox matrix. |
| infrastructure/02-networking | MOVE into Architecture and TOUCH. Reconcile the store tunnel profile name across the networking page, the Daytona how-to, and the configuration reference (one name only). |
| upgrades/multi-org-migration | KEEP in Upgrade and migrate. Content unchanged. |
| upgrades/oss-to-ee-switch | KEEP in Upgrade and migrate. Content unchanged. |
| upgrades/runner-and-store | TOUCH. Replace the internal branch-name prerequisite with a version number. |
| upgrades/v0.100.3-migration | KEEP in Upgrade and migrate. Content unchanged. |

New pages: Overview, Use your own subscription, How agents run, Sandbox isolation and security,
Run agents in a cloud sandbox (Daytona), Runner and sandbox configuration. Customize the agent
runtime replaces guide 08.

### Overview (new, explanation)

The landing page for the section. State what a person self-hosts: the agent studio and its
supporting services. State the editions (OSS and EE) and the open-source license and what it
covers. State the community-project support expectation moved from the FAQ. Link to Quick start as
the next step and to Agent execution for the model of where agents run. Keep it short.

## Variable and cross-page corrections

Apply on every touched page:

- Update Helm snippets to the `agentRunner.providers.*` values paths. Remove
  `agenta.sandboxLocalAllowed` and `agentRunner.daytona.installPi`.
- `SANDBOX_AGENT_LOG_LEVEL` becomes `AGENTA_RUNNER_LOG_LEVEL`.
- `AGENTA_RUNNER_TIMEOUT_SECONDS` and the `AGENTA_RUNNER_DAYTONA_SESSION_*` pair are already
  canonical and stay.
- `AGENTA_AGENT_MCPS_ENABLED` is out of scope for this cleanup.
- The API-side gate `AGENTA_SANDBOX_LOCAL_ALLOWED` becomes the same enabled/default provider pair
  read by the runner ([interface.md section 4](./interface.md)).

## Redirects

- `self-host/guides/deploy-the-agent-runner` to How agents run.
- `self-host/guides/custom-agent-runner-images` to Customize the agent runtime.
- `self-host/guides/agent-daytona-sandboxes` to the Daytona how-to.
- Old deploy, SSL, SSO, org-restriction, architecture, networking, upgrading, and
  dynamic-access-controls URLs stay valid through `slug`, so no redirect is needed for the folder
  moves.

## Acceptance

- A new reader can state what they self-host and the license scope after the Overview.
- A new reader can explain the runner topology after How agents run and the trust posture after
  Sandbox isolation and security.
- A trusted local operator completes the subscription tutorial with no hidden files.
- A Daytona operator never mounts or uploads a subscription credential.
- Compose comments are enough to discover the opt-in local subscription path.
- The runner reference contains no variable absent from code.
- Search finds no removed variable name in public docs or `hosting/`.
- Every deleted page redirects to its successor and every moved page keeps its URL.
- No page mixes two Diátaxis types.
