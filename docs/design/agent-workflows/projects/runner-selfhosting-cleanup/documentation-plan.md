# Documentation plan

The docs land with the phase 1 rename PR, not after every phase. The only real prerequisite for the pages is the final variable names. Troubleshooting entries whose error strings depend on later code land as that code lands.

The pages follow Diátaxis so readers do not have to extract a tutorial from a configuration reference. Five of the twenty existing self-host pages carry stale runner variables, no page describes the removed auto-upload behavior, and no page outside `docs/docs/self-host/` mentions a removed name. Section 10 assigns each existing page a disposition.

## 1. Explanation: how agent runs execute

Purpose: build the mental model. Today the runner story is spread across six partial tellings (configuration, guides 07 and 09, architecture, networking, runner-and-store). This page becomes the single one.

Explain:

- Services calls one runner service.
- Harness and sandbox provider are independent axes.
- One runner can support local and Daytona simultaneously.
- Managed model keys are per-run data; runner provider credentials are deployment infrastructure credentials.
- Session, agent, and transcript mounts provide different persistence; sessionless execution is the only implicit ephemeral case.

Do not include a complete environment-variable table or a copy-paste deployment recipe.

Proposed page: `docs/docs/self-host/agents/how-agent-runs-execute.mdx`.

## 2. Explanation: security and trust model

Purpose: answer the first question a self-hosting community will ask. No existing page covers this beyond two warning boxes.

Explain:

- Local runs share the runner container and are not an isolation boundary. They are a convenience for a single trusted operator.
- Daytona runs cross an explicit file and credential boundary; use Daytona when you need isolation.
- The enabled-provider list is the posture switch: a multi-user or exposed deployment runs `daytona` only, and then no user code can reach the runner's process environment.
- What crosses into a Daytona sandbox and what never does (the runner's Daytona credential, subscription mounts).
- Personal subscription mounts are single-tenant by definition.

Proposed page: `docs/docs/self-host/agents/security-model.mdx`.

## 3. Tutorial: run your first agent on a self-hosted deployment

Purpose: one end-to-end learning path, starting from the quick start.

1. start a clean OSS Compose stack;
2. create an agent with a managed model API key;
3. run a prompt and a tool call locally;
4. read the runner's startup summary;
5. pointer to the subscription how-to and the Daytona how-to as next steps.

Proposed page: `docs/docs/self-host/agents/tutorial-first-agent.mdx`.

## 4. How-to: use your own subscription (Pi, Claude, Codex)

Purpose: the opt-in local subscription path for a trusted personal deployment. State explicitly which subscriptions this covers: Pi login, Claude Code OAuth, and the ChatGPT/Codex login.

1. locate the supported login state for the harness;
2. uncomment the read-only volume mount in the Compose file and point the harness config variable at it;
3. run a self-managed agent;
4. remove the mount and verify the run fails with the explicit missing-configuration error.

Safety callouts: one personal subscription is for that operator, not all users of a shared deployment; local agents can inspect files visible to the runner container; do not expect this to work on Daytona (unsupported by design).

Proposed page: `docs/docs/self-host/agents/how-to-use-your-subscription.mdx`.

## 5. How-to: enable Daytona for agent workflows

Purpose: configure remote sandbox execution with managed model credentials. Replaces guide 09; its lifecycle and warm-session tables move to the reference.

Cover: Daytona API key; enabling `local,daytona` or Daytona alone; choosing the default; the `AGENTA_RUNNER_DAYTONA_*` variables; snapshot versus image; the snapshot build recipe in `services/runner/sandbox-images/daytona/`; public reachability requirements for durable storage; a smoke test; unsupported subscription combinations. Do not reuse code-evaluator Daytona variables, and remove the "one snapshot serves both" sharing story.

Proposed page: `docs/docs/self-host/agents/how-to-daytona.mdx`.

## 6. How-to: customize the agent runtime

Purpose: add binaries, certificates, and dependencies (chromium, the gh CLI). Replaces guide 08 and must fix its scope ambiguity: a user who wants extra tools *inside agent runs* needs the sandbox image or snapshot, not the runner service image.

Cover three distinct mechanisms, in order of what users actually want:

- extra dependencies for Daytona runs: build a custom snapshot with the shipped scripts;
- extra dependencies for local runs and a pinned runner build: build a custom runner service image from `services/runner/docker/Dockerfile.gh`;
- extra project folders for local runs: an operator-owned Compose volume mount.

Proposed page: `docs/docs/self-host/agents/how-to-customize-runtime.mdx`.

## 7. How-to: connect an external runner

Purpose: deploy the whole runner elsewhere and point Services at it. Absorbs the external-runner stub from guide 07.

Cover: `AGENTA_RUNNER_INTERNAL_URL`; the runner token; private networking and TLS termination; provider configuration on the external runner; storage reachability; failure diagnosis. The supported relocation unit is the whole runner, never a split harness container.

Proposed page: `docs/docs/self-host/agents/how-to-external-runner.mdx`.

## 8. Reference: runner configuration

Purpose: exact names, types, defaults, readers, secret classification, and conflicts. Replaces the agent-runner and agent-Daytona sections of the configuration page and the per-platform snippets of guide 07. Generate or check the table against the typed configuration schema so it cannot drift.

Group by: Services-to-runner routing; runner server; enabled/default sandbox providers (including that the API reads the same value); Daytona; session lifecycle and warm sessions; callback API; intentionally internal debug settings.

Every variable identifies: semantic role; consumer; default; whether empty is valid; whether it is secret; Compose location; Helm values path; conflicts and startup validation.

Proposed page: `docs/docs/self-host/agents/runner-configuration.mdx`.

## 9. Troubleshooting and extension points

Troubleshooting organized by symptom, cause, and exact check: requested provider disabled; runner unreachable or unauthorized; missing local subscription mount; remote subscription unsupported; snapshot or harness missing; Daytona authentication errors; store unreachable from Daytona; mount degradation warnings. Error text is copied from the shipped structured errors; entries whose errors land in later phases are added then.

End with extension points: another sandbox provider (Docker, E2B), another harness, or remote subscription support are tracked feature requests; link to the issue tracker.

Proposed page: `docs/docs/self-host/agents/troubleshooting.mdx`.

## 10. Existing page dispositions

New pages live under `docs/docs/self-host/agents/`. Existing pages:

| Page | Disposition |
|---|---|
| 01-quick-start, 03-upgrading, 04-dynamic-access-controls, 99-faq, guides 01/02/05/06, upgrades (all) | KEEP; add a pointer from quick start to the agents area |
| 02-configuration | TOUCH: replace the agent-runner and agent-Daytona sections with links to the runner reference; keep the evaluator `daytona` section but fix its cross-reference to the removed shared snapshot; delete the "Slice 1/Slice 2" roadmap language |
| guides/03-deploy-to-kubernetes | TOUCH: fix the "What gets deployed" list (include runner and store, consolidated workers) |
| guides/04-deploy-on-railway | TOUCH: rename the two stale variables in its runner table; fix its worker list |
| guides/07-deploy-the-agent-runner | DELETE: per-platform snippets go to the reference, the external-runner stub to how-to 7, the rest to the explanation page; redirect to the explanation page |
| guides/08-custom-agent-runner-images | DELETE: superseded by how-to 6; redirect there |
| guides/09-agent-daytona-sandboxes | DELETE: superseded by how-to 5 and the reference; drop the "Archived no longer exists" changelog prose; redirect to how-to 5 |
| infrastructure/01-architecture | TOUCH: slim the runner subsection to a link to the explanation page; fix the stale variable in the sandbox matrix |
| infrastructure/02-networking | TOUCH: reconcile the store tunnel profile name (`with-tunnel` vs `remote`) across 02, 09-successor, and networking |
| upgrades/runner-and-store | TOUCH: replace the internal "`big-agents` branch" prerequisite with a version number |

Also update every Helm snippet on the touched pages to the new `agentRunner.providers.*` values paths, and remove `agenta.sandboxLocalAllowed` and `agentRunner.daytona.installPi`.

Related rename decisions (defined in interface.md): `SANDBOX_AGENT_LOG_LEVEL` becomes `AGENTA_RUNNER_LOG_LEVEL`; `AGENTA_RUNNER_TIMEOUT_SECONDS` and the `AGENTA_RUNNER_DAYTONA_SESSION_*` pair are already canonical and stay; `AGENTA_AGENT_MCPS_ENABLED` is out of scope for this cleanup.

## 11. Documentation acceptance

- A new reader can explain the runner topology after the explanation page and the trust model after the security page.
- A trusted local operator can complete the subscription how-to without hidden files.
- A Daytona operator never mounts or uploads a subscription credential.
- Compose comments are sufficient to discover the opt-in local subscription path.
- The reference contains no variable absent from code.
- Search finds no removed variable in public docs or `hosting/`.
- Deleted pages redirect to their successors.
