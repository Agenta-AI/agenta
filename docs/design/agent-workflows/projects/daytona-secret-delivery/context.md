# Context

## Why this work exists

Agenta currently resolves one model connection and sends its credential values to the runner. On
the Daytona path, the runner puts those values into the sandbox creation request as plaintext
`envVars`. The harness and agent shell can therefore read them.

Daytona added a Secrets feature in SDK 0.192.0. A Daytona Secret is organization-scoped and
encrypted at rest. A sandbox receives an opaque placeholder in its environment. Daytona's outbound
HTTP(S) proxy replaces that placeholder with the real value only when the destination matches the
Secret's host allowlist. The plaintext is not placed in the sandbox.

This feature is the egress-substitution option discussed but deferred in the broader
[`secret-isolation`](../secret-isolation/api-design.md) project. It removes the need for Agenta to
operate a separate model proxy for supported credentials on Daytona. It does not solve secret
isolation on the local sandbox provider.

## Threat model

The adversary is code running in the sandbox, including an agent following a malicious or
prompt-injected instruction. It can read environment variables and files, inspect same-user
processes, and make arbitrary network requests allowed by sandbox policy.

The desired property is narrow:

> Sandbox code can use an approved credential against approved HTTP(S) hosts, but it cannot read
> the plaintext credential or send it to another host.

This does not prevent the agent from using the granted capability. An agent with an OpenAI key
placeholder can still make OpenAI requests. Model restrictions, budgets, approvals, and tool
allowlists remain separate policy controls.

We trust Daytona's control plane and egress proxy with the plaintext. This is not a zero-trust
design with respect to Daytona. It is a boundary change from "Daytona and sandbox code hold the
key" to "Daytona holds the key and sandbox code holds a constrained placeholder."

## Goals

1. Remove plaintext direct HTTP API keys from Daytona sandbox environment variables.
2. Keep Agenta control-plane credentials outside Daytona Secrets and outside the sandbox.
3. Create one isolated credential lease per sandbox, with deterministic cleanup and crash
   reconciliation.
4. Support standard model API keys, custom-provider API keys, and explicitly declared text custom
   secrets when their allowed HTTP hosts are known.
5. Fail closed for secret shapes that Daytona cannot safely substitute.
6. Preserve least privilege. Never copy the whole Agenta vault into Daytona.
7. Pin and verify the Daytona SDK upgrade before enabling secret delivery.

## Non-goals

- Protecting local sandbox runs. They still need the separate proxy or gateway design.
- Hiding the ability to call an approved provider from the agent.
- Sending Agenta API keys, tool-callback authorization, OTLP authorization, or `DAYTONA_API_KEY`
  into Daytona Secrets.
- Making AWS access keys, service-account JSON, private keys, or signing credentials work through
  placeholder substitution.
- Adding a generic "all project secrets" field to the agent configuration.
- Replacing Agenta's vault as the source of truth.

## Success criteria

- `env`, `/proc`, files, logs, and process arguments inside a Daytona sandbox contain placeholders,
  not plaintext, for supported credentials.
- The credential works against its allowlisted provider host and remains a placeholder everywhere
  else.
- Sandbox deletion eventually deletes every Daytona Secret created for that sandbox, including
  after runner crashes and failed sandbox creation.
- A credential with no non-empty host allowlist is rejected.
- Unsupported secret types fail with a clear error and never fall back silently to plaintext.
