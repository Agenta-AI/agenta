# Shipped contracts

## Vault metadata

A text custom secret may carry one optional `default_env_var` setting:

```json
{
  "name": "GitHub token",
  "slug": "github-token",
  "format": "text",
  "settings": {"default_env_var": "GITHUB_TOKEN"}
}
```

The shared Secret form shows **Default environment variable** directly below **Value**. It is optional metadata, not an Advanced field or a secret template. Settings and `request_secret` use the same Secret form controller and vault mutation. Successful callbacks expose saved identity and metadata, never raw content.

When choosing an attachment name, the request's `env_var` wins, followed by the selected secret's `default_env_var`, followed by a derived suggestion. A user edit becomes an attachment-only override and remains stable when the selected secret changes.

## Variant configuration

The authored reference lives under `parameters.agent.sandbox.credentials`:

```json
{
  "agent": {
    "sandbox": {
      "credentials": [
        {
          "secret": {"slug": "github-token"},
          "binding": {"type": "env", "name": "GITHUB_TOKEN"}
        }
      ]
    }
  }
}
```

`secret.slug` is project-scoped vault identity. `binding.name` is variant configuration. V1 accepts text custom secrets and `env` bindings only. Omitted credentials and an empty list have the same meaning.

Attachment requires permission to edit the secret and the agent. Desktop and mobile derive `edit_secret` from the authenticated project permission boundary. The backend enforces the write and runtime resolution boundaries.

Names use `^[A-Za-z_][A-Za-z0-9_]*$`. Resolution rejects missing, deleted, wrong-format, empty, duplicate, reserved, or colliding bindings. It resolves only slugs referenced by the current project and preserves nonempty text verbatim.

## Run transport

The SDK resolves authored references into `sandboxCredentials` before invoking the runner:

```json
{
  "sandboxCredentials": [
    {
      "binding": {"kind": "environment", "name": "GITHUB_TOKEN"},
      "value": "resolved-at-run-time"
    }
  ]
}
```

Values are runtime credential material. They participate in the credential epoch used for rotation and stale-session detection. Binding shape participates in configuration identity. The runner injects the materialized environment into local or Daytona execution and rebuilds an incompatible parked environment after rotation or removal.

The request can contain plaintext inside the protected SDK-to-runner transport. Redaction covers request logging, errors, traces, and saved diagnostics. Neither authored configuration nor client-tool output contains the value.

## `request_secret`

The reserved client tool uses `client:tool:request_secret:v0`. All input fields are required and additional fields are rejected:

```json
{
  "name": "GitHub token",
  "env_var": "GITHUB_TOKEN",
  "reason": "Authenticate the requested repository operation"
}
```

`name` and `reason` are display text. `env_var` is the requested binding suggestion. The authenticated paused interaction supplies project, agent, session, and tool-call identity.

A successful transaction creates or selects a vault secret, commits the binding to a variant revision, adopts that revision in the host, then settles the tool:

```json
{
  "status": "configured",
  "secret": {"slug": "github-token"},
  "env_var": "GITHUB_TOKEN",
  "revision_id": "019d952f-0000-0000-0000-000000000000"
}
```

Cancellation returns `{"status":"cancelled"}`. A malformed request cannot open configuration. A binding already present for the requested environment can continue without creating or attaching it again. If vault creation succeeds but attachment fails, retry reuses the saved slug and does not create a duplicate.

The host adopts the committed revision before auto-resume. A resume failure remains a visible conversation error and can be retried without repeating secret creation.

## Shared UI and guidance

The Secret form controller is shared by Settings and `request_secret`. The attachment drawer is shared by the **Advanced** configuration flow and the request dock. It receives bindings, requested metadata, edit identity, permission state, and a `commitBinding` callback. Agent settings render the section inside the existing **Advanced** drawer.

The shared platform instructions tell harnesses to use configured variables for authentication, never inspect or print their values, call `request_secret` when available, and never ask users to paste credentials into chat. `request_connection` remains for integration connections.
