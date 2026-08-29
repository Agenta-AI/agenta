# FS gateway research

Status: design research, not an implementation commitment.

## Thesis

The gateway exposes **FS instances**. Callers work with FS handles, paths,
directories, files, revisions, and attachments. They do not work with buckets,
object keys, Git blobs, storage credentials, or backend-specific mount commands.

The gateway is deliberately unaware of Agenta's project → agent → session
hierarchy. That hierarchy belongs to core configuration:

```text
Agenta core
  Mount / FS association
  project, agent, session, one-off rules
  configuration resolution
                    |
                    v
FS gateway
  generic FS, route, revision, access, attachment
                    |
                    v
S3-compatible or ArtifactFS-compatible backend
```

Core can associate the same generic FS handle with a project, agent, or
session, or create an ephemeral FS for one sandbox configuration. The FS
gateway enforces generic tenant isolation and FS authorization, but does
not interpret those Agenta subject types.

## Independent concerns

| Concern | Owner | Values/examples |
| --- | --- | --- |
| Product association | Agenta core | project, agent, session, one-off |
| Sandbox configuration | Core/sandbox domain | FS handle, path, access, revision, requiredness |
| Route governance | FS gateway | builtin, standard, custom |
| Backend implementation | FS gateway private layer | S3-compatible, ArtifactFS-compatible |

`builtin`, `standard`, and `custom` describe endpoint governance. S3-compatible
and ArtifactFS-compatible describe private persistence implementations. Neither
determines how core associates an FS with product entities.

## Gateway naming

The gateway keys are `llm`, `mcp`, `sbx`, and `fs`. This design uses
`fs` consistently in routes, packages, entities, and DTOs:
`FSGateway`, `FS`, `FSBinding`, `FSAttachment`, `fs_id`, and
`/v1/gateways/fs`.

`dfs` would promise distributed-FS semantics that the gateway does not define.
`vfs` is reserved for a possible internal virtual namespace/semantic layer and
would otherwise collide with the operating-system VFS concept.

## Relationship to current mounts

The current `Mount` domain should remain the core association/configuration
entity. It already records `project_id`, optional `agent_id` or `session_id`,
purpose, deterministic identity, protected behavior, and lifecycle rules.

The FS gateway adds a generic FS resource behind that association. During
compatibility rollout, an existing mount can map to an FS with the same
stable identity and physical content. Core continues to decide which mounts
belong in an agent or sandbox configuration.

## Documents

1. [Architecture](architecture.md)
2. [Entities](entities.md)
3. [Interfaces](interfaces.md)
4. [Backend and route profiles](providers.md)
5. [Work packages](plan.md)
6. [Acceptance tests](acceptance-tests.md)
7. [Raw research](rawresearch.md)
8. [Working notes](notes.md)
9. [Out of scope](outofscope.md)

## Design invariants

1. Every public FS operation is expressed in FS terms.
2. The FS gateway does not model project, agent, session, or their hierarchy.
3. Core owns `Mount` associations and resolves them into sandbox configuration.
4. A sandbox binding is configuration, like CPU or memory: FS handle,
   path, mode, revision, requiredness, and lifecycle intent.
5. Both backend families pass the same common FS conformance suite.
6. Generic tenant/security partitioning is opaque to the FS domain.
7. Backend identity, addressing, and credentials remain behind the gateway.
8. Existing mount IDs, associations, and content remain migration inputs rather
   than being redefined as gateway scope.
