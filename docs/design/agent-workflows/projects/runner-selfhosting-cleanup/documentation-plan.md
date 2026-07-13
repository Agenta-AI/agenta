# Documentation plan

Public documentation lands after the runtime and hosting contract is stable. The pages follow Diátaxis so readers do not have to extract a tutorial from a configuration reference.

## 1. Explanation: how agent runs execute

Purpose: build the mental model.

Explain:

- Services calls one runner service.
- Harness and sandbox provider are independent axes.
- One runner can support local and Daytona simultaneously.
- Local runs share the runner container and are not an isolation boundary.
- Daytona runs cross an explicit file and credential boundary.
- Managed model keys are per-run data.
- Runner provider credentials are deployment infrastructure credentials.
- Session, agent, and transcript mounts provide different persistence.
- Sessionless execution is the only implicit ephemeral case.

Do not include a complete environment-variable table or a copy-paste deployment recipe.

Proposed page: `docs/docs/self-host/agents/how-agent-runs-execute.mdx`.

## 2. Tutorial: run your first local agent with your own subscription

Purpose: teach one end-to-end learning path for a trusted personal self-hosted deployment.

The tutorial should:

1. start a clean OSS Compose stack;
2. locate the single runner service;
3. export or locate a supported Pi or Claude login;
4. mount the credential source read-only using a commented Compose example;
5. enable a local-only `harness-auth` bootstrap asset;
6. start the stack;
7. create a self-managed agent;
8. run a prompt and a tool call;
9. inspect the runner's redacted startup summary;
10. remove the mount and verify the self-managed run fails clearly.

Safety callouts:

- one personal subscription is for that operator, not all users of a shared deployment;
- local agents can inspect files visible to the runner container;
- use API keys or provider-approved organization authentication for multi-user deployments;
- do not target the auth asset at Daytona.

Proposed page: `docs/docs/self-host/agents/tutorial-local-subscription.mdx`.

## 3. How-to: enable Daytona for agent workflows

Purpose: configure remote sandbox execution with managed model credentials.

Cover:

- creating or selecting a Daytona API key;
- enabling both `local,daytona` or Daytona alone;
- choosing the default;
- runner-scoped Daytona environment variables;
- snapshot versus image;
- target and lifecycle values;
- public reachability requirements for durable storage;
- a smoke test and common errors;
- unsupported subscription combinations.

Do not reuse code-evaluator Daytona variables.

Proposed page: `docs/docs/self-host/agents/how-to-daytona.mdx`.

## 4. How-to: customize the runner runtime

Purpose: add binaries, certificates, and deterministic files.

Cover two separate mechanisms:

- build a custom runner image for installed programs;
- use bootstrap assets for per-run files or directories.

Explain local and Daytona materialization. Keep arbitrary scripts, VPN hooks, and plugins out of version 1.

Proposed page: `docs/docs/self-host/agents/how-to-custom-runner.mdx`.

## 5. How-to: connect an external runner

Purpose: deploy the whole runner elsewhere and point Services at it.

Cover:

- `AGENTA_RUNNER_INTERNAL_URL`;
- the runner token;
- private networking and TLS termination;
- the request-scoped callback credential and why no static runner API key is mounted;
- provider and bootstrap configuration on the external runner;
- health versus capabilities;
- storage reachability;
- failure diagnosis.

Do not describe a split where only the harness runs in another local container. The supported relocation unit is the whole runner.

Proposed page: `docs/docs/self-host/agents/how-to-external-runner.mdx`.

## 6. Reference: runner configuration

Purpose: provide exact names, types, defaults, readers, secret classification, and conflicts.

Generate the table from the typed configuration schema if practical. Group by:

- Services-to-runner routing;
- runner server;
- enabled/default sandbox providers;
- Daytona;
- session lifecycle;
- bootstrap;
- callback API;
- intentionally internal debug settings.

Every variable must identify:

- semantic role;
- consumer;
- default;
- whether empty is valid;
- whether it is secret;
- Compose location;
- Helm values path;
- conflicts and startup validation.

Proposed page: `docs/docs/self-host/agents/runner-configuration.mdx`.

## 7. Troubleshooting reference

Organize by symptom, cause, and exact check:

- "Authentication credentials not found" for Daytona;
- requested provider disabled;
- runner unreachable or unauthorized;
- missing local subscription asset;
- remote subscription unsupported;
- snapshot or harness missing;
- session mount signing failed;
- store unreachable from Daytona;
- FUSE transport disconnected;
- capability picker stale.

The error text in docs must be copied from the final structured errors, not invented before implementation.

## 8. Existing page migration

After new pages exist:

- split the current self-host configuration page so its runner section links to the focused reference;
- rewrite guides 07, 08, and 09 around the new how-to boundaries;
- remove shared Daytona snapshot wording;
- remove all old variables;
- remove instructions that rely on an extra subscription sidecar;
- keep redirects for published URLs if any, but do not keep environment aliases;
- update navigation and cross-links;
- verify OSS and EE examples separately.

## 9. Documentation acceptance

- A new reader can explain the runner topology after the explanation page.
- A trusted local operator can complete the subscription tutorial without hidden files.
- A Daytona operator never mounts or uploads a subscription credential.
- Compose comments are sufficient to discover the opt-in local subscription path.
- The reference contains no variable absent from code.
- Search finds no removed variable in public docs.
- Every troubleshooting entry maps to an automated error-path test.
