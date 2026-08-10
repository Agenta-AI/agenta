# The existing gateway model, and what it already settles

The connections/catalog/tools/triggers domains already implement most of the credential
model this research was deriving from first principles. This document records what is
there, so the MCP gateway extends it rather than reinventing it.

## The shape

Three layers, with the leaf split by domain:

```
catalog:      providers  →  integrations          (shared by tools and triggers)
leaves:       actions (tools)  |  events (triggers)
connections:  one authorization of one integration (shared shape)
```

The catalog port is explicitly shared — both domains browse the same integrations — while
each domain owns its own leaf adapter. Tools take actions, triggers take events. Everything
below the leaf is common.

## What already exists and should not be redesigned

### The auth-scheme axis

`ConnectionAuthScheme` is `oauth | api_key`, and it is duplicated verbatim as
`ToolAuthScheme` and `TriggerAuthScheme`. The distinction this research proposed as new is
already load-bearing across three domains.

### The connection state machine

`ToolConnectionState` — mirrored exactly by `TriggerDiscoveryConnectionState` — is:

- `ready` — an active and valid connection exists; reuse it
- `needs_auth` — an OAuth integration with no connection; start the flow
- `needs_input` — an API-key integration; collect a secret first

This is precisely the consent state machine, already implemented. A gateway does not invent
it; it reports into it.

### One flow for both auth schemes

The connection payload carries `callback_url`, `redirect_url`, and `auth_scheme`, and the
create-data comments are explicit that **no secret ever rides the payload** — an API key is
entered on the provider's hosted redirect page, exactly as an OAuth approval is clicked
there.

This is the answer to making the gateway uniform across auth schemes, and it is already the
implemented behaviour: **both schemes are "send the user to a URL, they come back
connected."** The caller sees one flow; only what happens on that page differs.

### Discovery tells the caller how to connect

Discovery results carry a `ConnectAffordance` naming the endpoint to call, alongside the
connection state. The caller is told what is missing and where to fix it, rather than
inferring it.

### Lifecycle verbs are already ports

`ConnectionsGatewayInterface` has `initiate_connection`, `get_connection_status`,
`refresh_connection`, and `revoke_connection`. Refresh is already a port verb, not something
to add.

### A first-party provider slot exists

`ConnectionProviderKind` and `ToolProviderKind` are both `composio | agenta`. The
first-party path is already modelled; it is not a new concept.

## The two-level split, and who holds which level

The persisted connection data carries two provider-side identifiers, and they are different
things:

- **`auth_config_id`** — the registered OAuth *application* for an integration: the client
  credentials that identify our software to the upstream provider. One per integration, not
  per user.
- **`connected_account_id`** — one user's *grant*: the token resulting from consent. One per
  connection.

The incumbent provider holds both. We persist only a local row pointing at them, plus
`is_active` / `is_valid` flags. **We store no tokens at all today.**

That is the concrete gap for a self-hosted gateway. Becoming the provider means holding
both levels ourselves:

- the `auth_config` level — our own client registration per authorization server, which the
  current MCP revision makes cheap via Client ID Metadata Documents;
- the `connected_account` level — **a token store with refresh, which does not exist and is
  the one genuinely new piece of persistence.**

## Scoping: project-level today, user-level later

Every DAO verb is keyed by `project_id`. `create_connection` also takes a `user_id`, but
that records authorship rather than scoping the lookup — queries and gets are project-scoped
only. Secrets are project-level for the same reason.

So the ownership axis in `credential-model.md` describes a **future** extension, not a
current choice. Today every entry is effectively `shared`. User-level secrets are a wanted
addition for user-specific model and MCP authentication, and the design should leave room
for them without requiring them.

What this means concretely:

- The gateway's credential lookup must take the owner as a parameter from the start, even
  while the only answer is the project. Retrofitting a per-user dimension into a lookup that
  assumes project is the expensive version of this change.
- `AuthScope` already carries `user_id` on every call, so the caller side needs nothing new
  when user-level secrets arrive. Only the storage and lookup change.

## Consequences

1. **The MCP gateway extends this model rather than replacing it.** An MCP server is another
   integration; its tools are that integration's actions; its authorization is an ordinary
   connection.
2. **The auth-scheme uniformity question is already answered** — one hosted redirect flow
   serves both schemes, with no secret on the payload.
3. **The one new component is a token store with refresh.** Everything else — states, ports,
   affordances, lifecycle verbs — exists.
4. **Three duplicated auth-scheme enums** are a sign the domains want a shared credential
   core, which is what a unified gateway would provide.
5. **Take the owner as a parameter now**, answer "project" for the time being.
