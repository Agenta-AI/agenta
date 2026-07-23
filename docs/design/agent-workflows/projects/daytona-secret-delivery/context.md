# Context

## Why this work exists

Agenta resolves credentials for the selected model and HTTP MCP servers. The current runner wire
then flattens model values into `AgentRunRequest.secrets` and resolved MCP values into each
server's `env` map. On Daytona, model values enter sandbox `envVars` as plaintext. HTTP MCP values
enter ACP session configuration as plaintext headers. Agent code can therefore read both.

Daytona Secrets are organization-scoped encrypted credentials. A sandbox receives an opaque
placeholder. Daytona's outbound HTTP(S) proxy replaces that placeholder only when the destination
host matches the Secret allowlist. Secret reads return metadata, not plaintext.

The feature can remove plaintext from the Daytona agent boundary for opaque HTTP credentials. It
cannot hide a value that code must parse, sign with, or use over another protocol. It also cannot
provide the same property on the local provider without a separate proxy.

## Threat model

The adversary is the agent and any code it runs inside a Daytona sandbox. It can read environment
variables and files, inspect same-user processes, change its own requests, and make any network
request permitted by sandbox policy.

The desired property is:

> Sandbox code can exercise an approved credential against one approved HTTP(S) host, but it
> cannot read the plaintext credential or send it to another host.

Daytona's control plane and Agenta's resolver are trusted with plaintext. The runner handles it
transiently to create the Daytona Secret. The agent, harness process, shell, files, logs, traces,
and durable session state must not receive it.

The capability itself remains usable. An agent with an OpenAI placeholder can make OpenAI calls.
Budgets, model restrictions, approvals, and tool policy remain separate controls.

## Goals

1. Replace plaintext Daytona delivery for supported model and HTTP MCP credentials.
2. Use one consumer-owned resolved contract for local and Daytona materialization.
3. Derive the destination from the consumer's effective model endpoint or MCP URL.
4. Create one isolated lease per sandbox binding and reconcile cleanup after crashes.
5. Keep Agenta, Daytona, telemetry, session, and tool-relay control-plane credentials outside the
   sandbox.
6. Keep unsupported credentials explicit. Never claim isolation or downgrade silently.
7. Pin and verify the Daytona SDK and control-plane behavior before rollout.

## Non-goals

- Giving the local provider secret isolation without a gateway or local egress proxy.
- Hiding approved provider capability from the agent.
- Copying all project or organization secrets into Daytona.
- Migrating the legacy Python evaluator. It is outside the agent-runner scope.
- Making SigV4, service-account JSON, private-key, or native-protocol credentials compatible with
  proxy substitution.
- Solving billing limits, provider authorization, model policy, or sandbox network policy through
  the credential contract.

## Success criteria

- Supported Daytona runs contain placeholders, not plaintext, in environment, ACP configuration,
  `/proc`, files, logs, arguments, traces, and persisted state.
- The allowlisted exact host receives plaintext. Every other host receives a placeholder or no
  request.
- Local and Daytona consume the same resolved contract and differ only in materialization.
- Missing values, resolution failures, empty hosts, wildcards, and unsupported isolated modes fail
  before sandbox creation.
- Sandbox deletion and crash reconciliation converge to zero orphan Secrets.
- The product and logs distinguish `isolated` from `non_isolated` credential delivery.
