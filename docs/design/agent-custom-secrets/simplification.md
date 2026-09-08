# Simplification decisions

V1 supports one task: attach a project text secret to an agent variant as an environment variable, including when an agent requests it during a conversation.

## One binding model

The variant stores `{secret.slug, binding:{type:"env",name}}` under `agent.sandbox.credentials`. Settings and paused conversations commit the same structure through ordinary revision semantics. There are no session grants, attachment tables, per-skill collections, or service presets.

## One shared form and drawer

The existing Secret form owns vault creation. Its only metadata extension is optional `default_env_var`, displayed directly below **Value**. The shared attachment drawer owns selection, creation, environment naming, edit identity, and retry state. Hosts own revision commit, adoption, settlement, and resume.

This split prevents raw secret content from reaching host callbacks and lets a saved vault entry survive an attachment conflict. Retrying attachment reuses the slug rather than recreating the secret.

## Existing lifecycle boundaries

The SDK resolves references for each run and sends typed `sandboxCredentials` to the runner. The runner uses its existing environment composition, redaction, desired-state, and credential-epoch mechanisms. Rotation or removal invalidates stale parked state. No apply endpoint, readiness poll, browser-owned injection flag, or transaction service was added.

## Separate client tools

`request_secret` handles custom environment credentials. `request_connection` remains responsible for integration and OAuth connections. Both use the existing browser-fulfilled interaction lifecycle, but they do not share request schemas or domain-specific controllers.

## Existing permissions

V1 uses existing secret-edit, agent-edit, and run permissions. Desktop and mobile resolve the authenticated project's capability and fail closed while it is unknown. The API remains authoritative. No secret-use role or hardcoded role mapping was added.

## Deferred V2

V2 may add host restrictions and opaque delivery. That work can introduce destination policy, allowlists, delivery modes, and Daytona-managed secret allocation after the readable flow has production evidence. V1 does not expose templates, advanced metadata, generic environment overrides, or live process patching.
