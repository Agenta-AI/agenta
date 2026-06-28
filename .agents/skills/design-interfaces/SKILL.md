---
name: design-interfaces
description: Design and review interface parameters by semantic role — classify each field by what it IS (data, config, policy, credentials, routing, metadata, protocol context), who owns it, when it changes, and whether a standard name exists — not by the feature it vaguely relates to. Use when designing or reviewing ANY interface shape - API request/response params, wire/protocol fields, config schemas, tool definitions, event payloads, function signatures with option bags. Triggers - designing a new endpoint/wire field/config block, reviewing a PR that adds or changes interface fields, "review the interfaces", any plan-feature/implement-feature step that defines or changes a contract.
user-invocable: true
---

# Skill: Design interfaces by semantic role, not feature

The one rule, above all:

> **Do not ask "what feature is this field related to?" Ask "what role does this field play?"**
> Then group fields by that role — by semantic responsibility, lifecycle, ownership, and standard
> boundary — not by the broad feature they happen to touch.

Most bad interfaces fail the same way: one bucket holds different *kinds* of things. The classic:

```jsonc
{ "trace": {
    "traceparent": "...",     // per-call propagation CONTEXT
    "endpoint": "...",        // exporter CONFIG
    "authorization": "...",   // exporter CREDENTIAL
    "captureContent": true    // capture POLICY
} }
```

Four different roles jammed under one feature label. The fix is not "better OTel naming" — it is to
split by role:

```jsonc
{ "context":   { "traceparent": "..." },
  "exporters": { "otlp": { "endpoint": "...", "headers": { "authorization": "..." } } },
  "capture":   { "content": { "enabled": true } } }
```

## Apply this whenever you touch a contract

Run it during design AND review, on every field added or changed. For each field ask:

1. What is this field, concretely?
2. Who owns / sets it? (caller, platform, operator, product policy, security policy)
3. When does it change? (per-call, per-run, per-resource, per-user, per-org, service-level)
4. What ROLE is it: data, config, policy, credentials, routing, metadata, or protocol context?
5. Is there a standard name or hierarchy for this concept already?
6. Will it likely grow into multiple sub-options later?
7. Could another engineer predict where this field lives?

If a child field does not answer the same question as its parent object, move it.

## The role taxonomy (group by these)

- **context** — information carried with THIS execution: request/trace id, session, idempotency
  key, caller metadata, locale-for-this-call. Per-call, platform- or caller-owned.
- **input / output** — the data being processed and the result. Caller-owned in, system-owned out.
- **config** — how the service behaves: endpoint, timeout, retry, exporter destination, provider,
  feature flags. Operator-owned, long-lived.
- **policy** — what is ALLOWED to happen: permissions, scopes, allowed tools, capture rules,
  redaction, retention. Security/product-owned.
- **credentials** — how to authenticate. Always nested under the thing they authenticate.
- **routing** — where things go / how a destination is chosen.
- **metadata** — descriptive info that is not core behavior.

## Core rules (the ones that catch the most mistakes)

1. **Separate runtime context from configuration.** Per-call context (trace id, idempotency key)
   never shares a bucket with service config (endpoint, timeout, retry) just because they relate to
   the same feature.
2. **Separate data from policy.** `{"input": "...", "captureInput": true}` → `{"input": "...",
   "capture": {"content": {"enabled": true}}}`. Policy controls what may happen to the data; it is
   not a sibling of the data.
3. **Put credentials under the thing they authenticate.** A token for an exporter → under the
   exporter's `headers`; for a model provider → under `model.credentials`; for a webhook → under the
   webhook. Never a free-floating top-level `authorization`.
4. **Put endpoints/URLs under the thing being contacted** (the client, provider, exporter, webhook,
   database), not under a vague feature node.
5. **Preserve standard names at the boundary.** `traceparent`, `baggage`, `authorization`,
   `content-type`, `idempotency-key` — keep them verbatim when a protocol/standard defines them.
   Normalize internally if you must, never at the edge.
6. **Do not expose implementation details as interface structure.** No `langfuseTraceUrl`,
   `postgresVectorTable`, `celeryQueue`, `dockerImage`. Expose the stable concept
   (`observability.exporters.langfuse.endpoint`, `execution.priority`), not the current mechanism.
7. **Keep protocol-boundary fields at the boundary.** Headers under `headers`, query under `query`,
   body under `body`, path under `path`. Don't flatten `authorization`/`traceparent`/`page` together.
8. **Make security-sensitive fields explicit, and prefer references over raw secrets.** Don't hide a
   token in `metadata`. Put it under `credentials`/`headers.authorization` — or better, pass a secret
   ID / env reference, not the secret itself.
9. **Prefer allowlists for dangerous behavior** (capture, tool execution, network, data export).
   `capture.content.{enabled,inputs,outputs}`, not `captureEverything: true`.
10. **Separate intent from mechanism** (`memory.retrieval.enabled`, then config picks Pinecone vs
    Postgres) and **user-facing API from internal execution** (`execution.priority`, not
    `celeryQueue`).

## Shape hygiene

- **Don't flatten too early; don't over-nest atomic fields.** Group `model: {provider, name,
  parameters: {...}, connection: {base_url, credentials: {...}}}` instead of a flat pile; but don't
  wrap a clearly-atomic `enabled` in three layers it will never use.
- **Nest when a setting is likely to grow** (`streaming: {enabled}` over `stream: true` if options
  are coming) — but **don't over-abstract before a second case exists** (no ten empty future
  sections).
- **Plural names for extensible maps:** `exporters.otlp`, `providers.openai`, `tools.search`,
  `headers.authorization` — not the singular.
- **Avoid vague buckets** (`options`, `settings`, `config`, `metadata`, `params`, `data`, `misc`)
  unless scoped by a clear parent (`model.parameters`, `retry.policy`, `request.metadata`).
- **Group by lifecycle and by ownership** — fields that change together, and fields set by the same
  owner, belong together; fields with different owners belong in different branches.
- **Design so invalid combinations are hard to express** (a typed `model.{provider, openai: {...}}`
  beats `provider: "openai"` next to a stray `anthropicApiKey`). **Name overrides as overrides.**
- **Consistent casing** (pick `lower_snake_case` or `camelCase` for your own fields), preserving
  external standard names. **Boring, predictable names** — `timeout_ms`, `retry.max_attempts`,
  `credentials.api_key` — never `magic`, `knob`, `payloadStuff`.

## Final checklist (run before finalizing or approving an interface)

For every field: per-call or service-level? · data/config/policy/credentials/routing/metadata? ·
does its parent describe the same kind of thing? · is there a standard name to preserve? · likely to
grow into sub-options? · does it leak an implementation detail? · is it under the system it
configures? · are secrets clearly scoped (or better, referenced)? · could another engineer
misread it? · can any field be moved/removed to make the hierarchy clearer?

A good top-level object reads as a few clear, role-named sections — e.g. `{ messages, context,
tools, memory, telemetry }` or `{ input, context, config, policy, metadata }` — where each name
answers "what role does this play?"
