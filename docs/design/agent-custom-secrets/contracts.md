# Proposed contracts

Current agent configuration has no general custom-secret bindings. The following shapes
are proposals for implementation, not examples of endpoints already available.

## Saved configuration

Put bindings under the sandbox configuration, which owns the process environment:

```json
{
  "agent": {
    "sandbox": {
      "kind": "daytona",
      "credentials": [
        {
          "secret": { "slug": "github-token" },
          "binding": { "type": "env", "name": "GITHUB_TOKEN" }
        }
      ]
    }
  }
}
```

This is the `parameters.agent` fragment. The SDK flattens it into its runtime model
using the existing template parser. Omitted credentials and an empty list are identical.
There is one environment binding per entry. Milestone one supports only `env` bindings
and text custom secrets; it adds no delivery-mode picker.

| Field                                       | Role and owner                                                   | Lifetime                         |
| ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| `secret.slug`                               | Credential reference selected by the user in the current project | Saved agent revision             |
| `binding.type`, `binding.name`              | Environment binding configuration selected by the user           | Saved agent revision             |
| Secret content                              | Credential material owned by the vault                           | Until value rotation or deletion |
| Project, agent, session, tool-call identity | Existing authenticated execution context                         | Request or paused interaction    |
| Future allowed hosts and delivery mode      | Policy owned by the vault secret                                 | Until an authorized policy edit  |

The agent suggests a variable name; the user approves it. Slugs and variable names are
different identifiers. Do not derive the final variable name from the slug.

Validate names with `^[A-Za-z_][A-Za-z0-9_]*$`. Reject duplicate bindings, platform-reserved
names, provider/MCP collisions, and environment-control names such as `PATH`, `HOME`,
`LD_PRELOAD`, `NODE_OPTIONS`, and `PYTHONPATH`. Use one canonical validation rule set with
Python/TypeScript parity cases, including runner-owned environment names. Do not silently
overwrite any existing environment owner.

Resolve only the referenced project secrets. Reject missing, deleted, wrong-kind, JSON,
and empty text values before invoking the harness. Preserve nonempty text verbatim.
The attachment flow requires the existing secret-edit permission and agent-edit permission;
execution still requires run permission and project-scoped runtime resolution. The backend
must enforce attachment permissions for every configuration write path, including agent
commit tools, rather than relying on the form. This deliberately uses existing permissions
for internal use; it does not add a new secret-use RBAC system.

## Runner input

Add a typed `sandboxCredentials` collection to the internal run request. Each entry
contains an environment binding and resolved credential value. It contains no vault
access token and grants the runner no whole-vault lookup capability. Reuse the existing
binding primitive and redaction treatment where compatible, but do not put these values
inside `modelConnection` or an MCP connection.

The authored reference is resolved before this transport boundary. The SDK serializer,
Python wire model, TypeScript protocol, runner validator, and wire fixtures change together.
Values must be redacted before request/error logging and tracing. Existing protected
transport carries plaintext credential material to the runner, as it does for readable
credentials today. A raw transport capture can contain credentials; saved diagnostic
snapshots must be redacted. Never describe an unredacted internal request as value-free.

The runner adds the collection to its environment composition and credential-change
tracking. Binding structure participates in both existing configuration identity views;
values participate in the existing credential epoch, never a public configuration hash.
No generic arbitrary environment override or global change to Daytona hiding is needed.

## Agent request tool

Add `request_secret` as a reserved platform client tool, following the static catalog
and existing browser-fulfilled interaction mechanism. Do not overload OAuth-oriented
`request_connection` inputs with unrelated fields.

Proposed input:

```json
{
  "name": "GitHub token",
  "env_var": "GITHUB_TOKEN",
  "reason": "Authenticate the requested repository operation"
}
```

`name` and `reason` are display metadata. `env_var` is suggested binding configuration.
The schema has no value field, project selector, agent selector, or destination policy.
The host derives the target from the paused interaction and authenticated session.
Only advertise this tool where the host can fulfill it; guidance must account for its
absence. The agent receives configured variable names through safe configuration/tool
metadata, so it need not run `printenv` to discover them.

Successful setup returns a reference and the committed revision, not a value:

```json
{
  "status": "configured",
  "secret": { "slug": "github-token" },
  "env_var": "GITHUB_TOKEN",
  "revision_id": "019d952f-0000-0000-0000-000000000000"
}
```

Cancellation returns `{"status":"cancelled"}`. Other terminal failures use a bounded
safe reason. `configured` means the binding was saved. The runtime must apply it before
the resumed harness receives that result. Browser output is not authorization: the
backend checks the saved revision, project, permissions, and requested binding again.

## Platform instructions

Extend `AGENTA_PLATFORM_BASE` in the module introduced by #6365 as part of milestone
one's child implementation. Do not edit the parent PR or ship a second prompt composer.
The required text is:

> Use configured credential variables only to authenticate the requested operation.
> Do not inspect, print, enumerate, or include their values in messages or files.
> If a required credential is unavailable and `request_secret` is available, use it
> to open the secret setup flow. Otherwise explain that the user must configure the
> credential in Agenta. Never ask the user to paste a credential into chat.

Scripts and libraries may read variables for authentication. The restriction concerns
exposing values to the model or other outputs. Review existing instructions that direct
all credentials to `request_connection`: distinguish integration connections from custom
shell credentials and keep generic `request_input` value-free.

#6365 delivers text at environment build through Pi append-system text or Claude/Codex
instruction files. It does not promise a fresh system message on every turn. The rollout
must build fresh environments before enabling custom bindings; a warm environment created
before the guidance was deployed must not begin consuming custom secrets without it.
