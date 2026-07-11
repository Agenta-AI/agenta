# QA plan

## Security assertions

For every supported credential, assert the real random marker is absent from:

- `env` and language runtime environment APIs;
- `/proc/self/environ` and readable peer-process environments;
- process arguments and process listings;
- uploaded files, harness settings, shell history, and durable mounts;
- sandbox-agent, harness, runner, and Daytona-visible application logs;
- traces, errors, request echoes, and persisted session state.

Assert the placeholder is present where the harness expects the credential. The test must search
for the random plaintext marker, not only known variable names.

## Network substitution matrix

| Case | Expected result |
|---|---|
| Exact allowlisted HTTPS host | Remote host receives plaintext; sandbox sees placeholder. |
| Different host | Remote host receives placeholder or request is rejected; never plaintext. |
| Subdomain without wildcard | No plaintext. |
| Explicit allowed wildcard | Works only for the documented base and subdomains. |
| Redirect to disallowed host | No plaintext at redirect destination. |
| Redirect from disallowed to allowed host | Confirm documented behavior; no earlier disclosure. |
| Non-HTTPS URL | Rejected by Agenta policy. |
| IP literal, localhost, metadata IP | Rejected before Secret creation. |
| Alternate port | Verify host matching and ensure policy cannot be widened accidentally. |
| DNS change or rebinding attempt | No plaintext outside the approved TLS host boundary. |

## Provider matrix

- OpenAI direct.
- Anthropic direct.
- One additional header-key provider such as Mistral or Groq.
- Azure OpenAI with exact custom endpoint host.
- Custom OpenAI-compatible endpoint.
- Bedrock access-key flow, expected fail-closed.
- Vertex service-account flow, expected fail-closed.
- Self-managed OAuth, explicitly unchanged and not claimed secure by this feature.

## Custom-secret matrix

- Text bearer token with explicit HTTPS host, supported.
- Text value used in a request body unchanged, verify substitution.
- Flat JSON parsed locally, expected fail-closed.
- Private key or signing secret, expected fail-closed.
- Secret requested by no consumer, never resolved or copied.
- Missing custom secret, run fails before sandbox creation.
- Hostless or wildcard-all declaration, rejected.

## Lifecycle matrix

- Successful create, run, destroy, and Secret delete.
- Partial multi-Secret creation failure with compensation.
- Sandbox create failure after Secret creation.
- Daemon start failure after sandbox creation.
- Pause and resume with the same placeholders.
- Stop, archive, and resume.
- Value rotation during a parked session.
- Host change requiring restart or fresh sandbox.
- Runner termination before sandbox ID persistence.
- Runner termination after sandbox persistence but before Secret metadata persistence.
- Daytona sandbox auto-delete without runner teardown.
- Secret deletion transient failure and retry.
- Two cleanup workers racing on the same lease.
- Janitor pagination beyond 200 Secrets.

## Dependency upgrade checks

- `pnpm test` for the runner unit suite.
- runner TypeScript typecheck.
- exact lockfile version, no caret drift.
- no duplicate old/new Daytona SDK clients in the production bundle.
- existing sandbox create, preview URL, process execution, file upload, mount, destroy, and reconnect
  tests.
- live Pi and Claude smoke runs on Daytona where currently supported.
- verify self-hosted Daytona below the minimum version fails at startup capability validation, not
  halfway through a run.

## Observability and redaction

Log only counts, provider class, sandbox ID where already permitted, and opaque lease ID. Never log
Secret values, Daytona placeholders, Agenta secret slugs, Daytona Secret names, or full create
payloads.

Metrics:

- Secret create/update/delete latency and failures;
- sandbox create latency added by lease provisioning;
- active leases and orphan leases;
- oldest orphan age;
- reconciliation deletions and failures;
- provider authentication failures after rotation;
- fail-closed counts by unsupported credential class.

## Acceptance bar

The feature is not ready based on unit tests alone. It requires live disposable-credential tests
against the supported Daytona control plane and a deliberate runner-kill cleanup test.
