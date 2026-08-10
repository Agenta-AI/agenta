# Secret scoping and resolution

Designed, **not scheduled for implementation**. Today every secret and every connection is
project-scoped. This document defines how user-level credentials would work and how the two
levels resolve against each other, so that the gateway's lookup is built with the dimension
present from the start rather than retrofitted.

## Why design it before building it

The lookup signature is the expensive part to change later. A credential lookup that takes
an owner and currently always answers "the project" costs nothing extra today, and absorbs
user-level credentials as a storage change rather than a refactor of every call site. The
inverse — a lookup that assumes the project — spreads that assumption everywhere the
gateway is used.

The caller side needs nothing either way: `AuthScope` already carries organization,
workspace, project and user on every request.

## The owner

A secret is owned by exactly one of:

- **project** — what exists today. Everyone in the project uses it.
- **user** — one member's own credential.

A user-owned secret is keyed by **(project_id, user_id)**, not by user alone. Two reasons:
the same person may legitimately use different credentials in different projects, and a
deleted project should take its secrets with it.

A genuinely account-wide credential — one identity across every project — would be keyed by
(organization_id, user_id) instead. That is a third owner, not a variant of the second, and
it is deliberately out of scope until something needs it.

## The resolution mode

Resolution is not simply "user wins." Three modes, declared per entry, because the
organization sometimes has a legitimate interest in which credential is used:

| Mode | Behaviour | Use for |
|---|---|---|
| `user_optional` | user's if present, else project's | the sensible default |
| `user_required` | user's, or fail — never fall back | upstreams holding personal data, where a shared identity is wrong |
| `project_only` | always the project's, ignore user secrets | organization-mandated credentials, spend control |

The two non-default modes are the ones that earn the design. `user_required` stops an agent
quietly acting as somebody else's account when it reaches a personal mailbox.
`project_only` stops a user's own key being used where the organization is paying and wants
a single billing identity — which is the common case for models.

Note the asymmetry this produces, and that it is intentional: model credentials will usually
be `project_only`, tool and MCP credentials usually `user_optional` or `user_required`.

## Resolution

One function, called by both gateways:

```
resolve(auth_scope, key, mode) -> credential
```

1. `project_only` → the project secret; fail if absent.
2. `user_required` → the (project, user) secret; fail if absent, never fall back.
3. `user_optional` → the (project, user) secret if present, else the project secret; fail if
   neither.

Failure is never silent and never a fallback to "no credential." It surfaces as the existing
needs-input or needs-auth state, naming which owner is missing a credential, so the caller
is told whether *they* must connect or whether an administrator must.

## What has to travel with the result

The resolved credential is not enough on its own. Two more values have to come back with it,
because things downstream need them:

- **which owner supplied it** — the audit record has to distinguish "acted using the
  project's credential" from "acted using their own." Without it, a compliance review cannot
  reconstruct whose authority a call carried.
- **who pays** — if a call runs on a user's own credential, the cost lands on that user's
  upstream account rather than the organization's. A meter that records only the calling
  principal attributes that spend to the wrong payer.

The second is easy to miss and hard to correct after the fact, since the data to fix it is
not retained.

## Effect on existing data

Existing secrets and connections all become owner = project, which is what they already are.
This is a default column value, not a data migration.

## Open

- The product default: is `user_optional` the norm and `project_only` the exception, or the
  reverse? This decides how much of the existing configuration has to be revisited when
  user-level credentials ship.
- Whether an administrator may set the mode per upstream, or whether it is a property of the
  upstream itself.
- Whether a user-owned credential should be visible to project administrators at all, and
  what that implies for support and for deletion when a member leaves.
