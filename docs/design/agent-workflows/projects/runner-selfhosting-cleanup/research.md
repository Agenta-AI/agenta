# Research

Date: 2026-07-13

## Repository evidence

### Provider resolution

The runner currently resolves the sandbox from the request, then `SANDBOX_AGENT_PROVIDER`, then `local`. The provider factory recognizes local and Daytona and keeps E2B as planned work.

The target keeps per-run selection but moves the default and enabled set into one runner-owned configuration object. The runner remains the authoritative execution gate.

### Daytona snapshot resolution

`services/runner/src/engines/sandbox_agent/provider.ts` resolves the agent snapshot with:

~~~ts
process.env.DAYTONA_SNAPSHOT_AGENT ?? process.env.DAYTONA_SNAPSHOT
~~~

Compose always injects `DAYTONA_SNAPSHOT_AGENT` and substitutes an empty string when the operator does not set it. An empty string is not nullish, so the configured shared snapshot is discarded. The existing unit test deletes the variable and misses the Compose case.

PR #5274 also introduced `AGENTA_AGENT_SANDBOX_DAYTONA_SNAPSHOT` in one OSS SSL Compose file. No runtime reads it.

The larger fix is not another fallback expression. The target has one agent-runner snapshot variable, `AGENTA_RUNNER_DAYTONA_SNAPSHOT`, and no shared code-evaluator default.

### Automatic Pi OAuth upload

For a self-managed run, `shouldUploadOwnLogin` treats `credentialMode=runtime_provided` as permission to upload local login state. `uploadPiAuthToSandbox` copies the runner's entire Pi `auth.json` and settings into Daytona. It does not select only the credential needed by the run.

That couples three unrelated decisions:

1. the workflow uses runtime-provided authentication;
2. the runner happens to have Pi state;
3. the state should be copied to a third-party remote sandbox.

The target removes this inference. Local subscription use requires an explicit read-only mount. Daytona runtime-provided subscription authentication is unsupported in version 1.

### Runtime-fact and policy booleans

`AGENTA_AGENT_SANDBOX_PI_INSTALLED` changes whether the runner installs Pi in Daytona. It is easy for the flag and snapshot contents to disagree. The runner already controls the pinned Pi version and can probe the executable.

`AGENTA_SESSION_HARNESS_MOUNTS` turns harness transcript mounts on and off globally. These mounts exist to make a durable session work. Their presence should derive from the session contract, not from a public deployment switch.

Both variables are removed.

### Best-effort mounts

Mount signing and mounting can currently degrade to an ephemeral directory. On Daytona, a store endpoint that is unreachable from the sandbox can also produce a plain directory at the expected durable path. This gives a successful run whose files or harness state later disappear.

Request identity defines what persistence a run is supposed to have:

- sessionless run: ephemeral is valid;
- session id present: the session cwd;
- workflow artifact present: the agent mount;
- continuation that needs harness-native state: transcript mounts.

Version 1 keeps best-effort behavior and logs one structured warning when a durable mount degrades, so the degradation rate becomes measurable. Failing the run instead is RSH-11.

## PR #5285 assessment

[PR #5285](https://github.com/Agenta-AI/agenta/pull/5285) contains two useful directions:

- model providers as a typed capability axis, with future Docker and E2B implementations;
- capability-based lifecycle behavior instead of adding `isDocker` beside `isDaytona`.

Its proposed `AGENTA_RUNNER_SANDBOXES_ALLOWLIST` contract should not be implemented as written:

- Unset or empty means all known providers, so adding a provider changes existing deployments.
- It is read independently by API, Services, runner, and web, which creates four sources that can drift.
- It preserves `AGENTA_SANDBOX_LOCAL_ALLOWED` as an alias even though the product is pre-production.
- "Allowlist" frames normal runtime capability configuration as an access-control exception.
- The singular default remains in the unrelated `SANDBOX_AGENT_*` namespace.

This project instead uses:

- `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`;
- `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`;
- local-only as the unset default;
- runner authority plus capability discovery for upstream UX;
- no compatibility alias.

The Docker implementation stays a separate project. Its discriminated provider and lifecycle-capability model is a dependency for future extensibility.

## PR #5286 assessment

[PR #5286](https://github.com/Agenta-AI/agenta/pull/5286) contains two changes to keep:

- `AGENTA_RUNNER_TOKEN` on both the caller and runner;
- narrowing inherited model-provider keys using the declared provider and deployment.

Two parts need revision:

### No provider-key escape hatch

`AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS` restores the insecure behavior for callers that omit provider metadata. The wire contract already has `provider`, `deployment`, and `credentialMode`. Because the feature is pre-production, those fields should become required where needed and unknown values should fail. There should be no public "inherit everything" mode and no un-migrated-caller branch.

### No Helm common environment

The PR includes `agenta.commonEnv` in the runner deployment. That block contains application license, Postgres password and URIs, Agenta auth and cryptographic keys, Redis credentials, store master credentials, and unrelated service configuration.

A local harness can inspect the runner process environment. Injecting `commonEnv` therefore exposes the whole application trust domain to every local agent. The runner needs a narrow set instead:

- its own server and provider configuration;
- the Services-to-runner shared token;
- an Agenta API locator;
- scoped per-run credentials delivered in the request.

The current run request already carries the caller credential used for session coordination, mount signing, and trace export. The target removes the process-wide `AGENTA_API_KEY` fallback rather than introducing another reusable runner secret.

If #5286 lands first, the cleanup must remove `commonEnv` from the runner template while preserving the runner token and least-privilege model-key logic.

## PR #5274 assessment

[PR #5274](https://github.com/Agenta-AI/agenta/pull/5274) made valuable changes to mount identity, mount permissions, workflow-artifact validation, geesefs recovery, snapshot contents, and generated clients.

Follow-up work from its review:

- fix the empty-string snapshot regression immediately;
- remove the dead snapshot variable;
- do not describe the PR as mount-viewer UI work, because it contains generated web clients only;
- keep the new mount permissions without a compatibility bridge for unpublished custom roles;
- make the session and agent mount contract fail loudly.

## Subscription terms and support boundary

Official OpenAI material says ChatGPT-plan Codex use starts through supported Codex clients and that users may not share account credentials or make an account available to another person. It does not document Pi as an approved client or authorize copying a Codex OAuth file into a third-party sandbox.

This is not a legal conclusion. It is an engineering support decision under uncertainty:

- Agenta will not automatically copy OpenAI or Anthropic subscription state to Daytona.
- The first tutorial covers a user mounting their own credential into their own trusted local self-hosted runner.
- Remote subscription support remains closed until the provider confirms the intended client, storage, and execution model in writing.
- API-key authentication remains the supported Daytona path.

Sources:

- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/)
- [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy)
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-chatgpt)

## Current support matrix

| Sandbox | Harness | Managed API key | Local subscription |
|---|---|---:|---:|
| local | Pi | supported | supported through an explicit mount |
| local | Claude | supported | supported through an explicit mount |
| Daytona | Pi | supported | unsupported |
| Daytona | Claude | supported | unsupported |

"Local subscription" means the operator's own credential in a trusted self-hosted runner. It is not a mechanism for sharing one subscription across Agenta users.
