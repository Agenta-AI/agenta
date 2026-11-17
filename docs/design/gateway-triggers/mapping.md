# Gateway Triggers — Mapping & Config

How the outbound **webhooks** domain lets a subscriber *shape the payload* it receives,
and how the same mechanism applies — in the opposite direction — to mapping an inbound
trigger **event** into a workflow invocation.

This is the inbound dual of the webhook payload-mapping problem, so we copy the webhook
mechanism rather than invent one.

---

## 1. How webhooks define their mapping today

A webhook subscription stores a **payload template** and the delivery layer resolves it
against a curated **context** at send time.

### The config field

`WebhookSubscriptionData.payload_fields: Optional[Dict[str, Any]]`
(`core/webhooks/types.py:119`). It is an arbitrary JSON structure that doubles as a
template: leaves that are *selector strings* get replaced by values pulled from context;
everything else is passed through literally.

### The context it resolves against

At delivery, `prepare_webhook_request` (`core/webhooks/delivery.py:118`) builds a fixed,
**allowlisted** context:

```python
context = {
    "event":        {k: v for k, v in event.items()        if k in EVENT_CONTEXT_FIELDS},
    "subscription": {k: v for k, v in subscription.items() if k in SUBSCRIPTION_CONTEXT_FIELDS},
    "scope":        {"project_id": str(project_id)},
}
```

- `EVENT_CONTEXT_FIELDS` = `{event_id, event_type, timestamp, created_at, attributes}`
- `SUBSCRIPTION_CONTEXT_FIELDS` = `{id, name, tags, meta, created_at, updated_at}`
  (`core/webhooks/types.py:26`)

The allowlist is the security boundary: a subscriber's template can only reference these
keys, never arbitrary internal state.

### The resolver (the template language)

`resolve_payload_fields` (`delivery.py:95`) — to be renamed `resolve_target_fields` when
promoted to the SDK (§5/§6) — walks the template recursively; each leaf goes
through `resolve_json_selector` (`sdks/python/agenta/sdk/utils/resolvers.py:114`):

- string starting with `$` → **JSONPath** against context
- string starting with `/` → **JSON Pointer** against context
- anything else (plain string, number, dict, list) → returned **as-is** (literal)
- resolution failure → `None` (never raises); depth-capped (`MAX_RESOLVE_DEPTH`)

Default when `payload_fields is None`: `"$"` — i.e. deliver the whole context
(`delivery.py:149`).

### Worked example (webhooks)

Template stored on the subscription:

```json
{
  "kind": "agenta.event",
  "type": "$.event.event_type",
  "when": "$.event.timestamp",
  "project": "$.scope.project_id",
  "sub": "$.subscription.name"
}
```

Resolved and POSTed to the subscriber URL:

```json
{
  "kind": "agenta.event",
  "type": "traces.queried",
  "when": "2026-06-18T10:00:00Z",
  "project": "019abc...",
  "sub": "my-prod-hook"
}
```

So the webhook "mapping" is: **subscriber-authored JSON template + selectors over an
allowlisted context, resolved at delivery.** Static where the subscriber wants constants,
dynamic where they reference `$.event.*` / `$.subscription.*` / `$.scope.*`.

---

## 2. Decompose the webhook subscription: three independent concerns

`WebhookSubscriptionData` (`core/webhooks/types.py:116`) bundles three concerns that are
actually independent. Separating them is the key to seeing what carries over to triggers
unchanged and what genuinely differs:

```python
class WebhookSubscriptionData(BaseModel):
    url, headers, auth_mode   # DESTINATION — where/how to deliver
    payload_fields            # MAPPING — how to shape the body
    event_types               # FILTER — which events
```

| Concern | Webhook field | Carries to triggers? |
|---------|---------------|----------------------|
| **filter** — which events | `event_types` | **same idea** — which provider event this subscription watches |
| **mapping** — shape the data | `payload_fields` | **same mechanism** — identical resolver + context; the field is named `inputs_fields` because it maps into `data.inputs`, not a whole body (§3, §4.2) |
| **destination** — where it goes | `url`, `headers`, `auth_mode` | **different** — a workflow `references` + `selector`, not a by-value URL (§4.1) |

So the answer to "why would mapping/context differ?": the **mechanism and context don't**
(same resolver, same `{event, subscription, scope}`). Two things do, and both follow from
the target being an internal workflow rather than an external URL: the **destination** is a
`references`/`selector` (§4.1), and the mapping field maps into **`data.inputs`** rather
than a whole HTTP body, so it is named `inputs_fields` (§4.2).

---

## 3. Same mapping mechanism + context; field named for its target

### The field — `inputs_fields` (webhooks' `payload_fields`, retargeted)

Triggers store the **same kind of template** webhooks store in `payload_fields`: a JSON
structure with `$`/`/` selectors over context, same resolver, same default. The **field is
named `inputs_fields`** rather than `payload_fields` because it maps into
`WorkflowServiceRequest.data.inputs` (§4.2), not a whole HTTP body. The name states the
target — the same reason webhooks' field is called *payload*_fields (it maps the payload).

```text
webhooks subscription:  payload_fields  →  whole HTTP body
triggers subscription:  inputs_fields   →  request.data.inputs
```

Mechanism, resolver, and context are identical; only the field name and its target differ.

### Same context — `{event, subscription, scope}`

Resist the temptation to expose the raw Composio envelope (`{data, metadata}`) directly.
Keep the **identical three-slot, allowlisted** context webhooks uses — the slots just bind
to the inbound analogues:

| Slot | Webhooks (outbound) | Triggers (inbound) |
|------|---------------------|--------------------|
| `event` | the Agenta event that fired (allowlisted) | the verified provider event that arrived (allowlisted) |
| `subscription` | the webhook subscription (allowlisted) | the trigger subscription (allowlisted) |
| `scope` | `{project_id}` | `{project_id}` (recovered from `metadata.user_id`) |

```python
# triggers — same shape as webhooks' prepare_webhook_request context
context = {
    "event":        {k: v for k, v in inbound_event.items() if k in TRIGGER_EVENT_FIELDS},
    "subscription": {k: v for k, v in subscription.items()   if k in SUBSCRIPTION_CONTEXT_FIELDS},
    "scope":        {"project_id": str(project_id)},
}
```

`TRIGGER_EVENT_FIELDS` is the triggers analogue of `EVENT_CONTEXT_FIELDS` — an allowlist
over the inbound event (its `data`, `type`, `timestamp`, and curated `metadata` like
`trigger_slug`/`trigger_id`/`toolkit_slug`), never exposing `ca_*`, secrets, or connection
internals. Same discipline, same security boundary, identical resolver
(`resolve_target_fields` → `resolve_json_selector`, `$`/`/` selectors, literal
passthrough, null-on-miss).

### Worked example (triggers)

Subscription `inputs_fields` (Gmail "new message" → a triage workflow):

```json
{
  "subject":  "$.event.data.subject",
  "from":     "$.event.data.from",
  "body":     "$.event.data.message_text",
  "received": "$.event.timestamp",
  "watch":    "$.subscription.name",
  "source":   "gmail"
}
```

Inbound event at `/triggers/composio/events/` (its allowlisted form becomes `context.event`),
resolved to:

```json
{
  "subject": "Refund?", "from": "a@x.com", "body": "...",
  "received": "2026-06-18T10:00:00Z", "watch": "support-triage", "source": "gmail"
}
```

**Important — this resolved object is *not* the whole request.** It becomes only
`WorkflowServiceRequest.data.inputs` (§4.2). The destination (which workflow) comes from a
separately-stored reference (§4.1), and the envelope/auth is filled by `invoke_workflow`.

---

## 4. The two real differences: destination, and *what* the payload maps into

The actual `invoke_workflow` request type is `WorkflowServiceRequest`
(= `WorkflowInvokeRequest`, `sdks/python/agenta/sdk/models/workflows.py:257-262`):

```python
WorkflowBaseRequest:
    version
    references: Dict[str, Reference]    # WHICH workflow/revision  ← destination
    links:      Dict[str, Link]
    selector:   Selector                # which slice to extract
    secrets, credentials                # auth — filled by invoke_workflow internally
WorkflowInvokeRequest(WorkflowBaseRequest):
    data: WorkflowRequestData
        revision, parameters, testcase, inputs, trace, outputs   # the payload area
```

This makes two things precise that a naive "webhooks but inbound" framing gets wrong.

### 4.1 Destination = `references` (+ `selector`), the existing /retrieve shape

A webhook's destination is described **by value** — `url`, `headers`, `auth_mode` inline.
A trigger's destination is an Agenta **workflow**, an internal entity, so it is described
**by reference** using the **same `Reference` / `Selector` primitives the `/retrieve` and
inspect paths already use** — not an ad-hoc `{workflow_id, ...}`.

`Reference(Identifier, Slug, Version)` = `{ id?, slug?, version? }`
(`sdks/.../models/shared.py:102`). `invoke_workflow` already threads
`request.references` / `request.selector` straight through (`service.py:556-557`).

So the subscription stores a workflow **reference** (+ optional selector), and dispatch
drops it into `request.references`:

```text
webhook destination:  { url, headers, auth_mode }                  ← by value
trigger destination:  references: { "workflow": Reference{id|slug, version} } [+ selector]
                                                                   ← by reference, same as /retrieve
```

No new addressing scheme — reuse how workflows are referenced everywhere else.

### 4.2 The mapping (`inputs_fields`) maps into `data.inputs`, NOT the whole request

For **webhooks**, `payload_fields` maps to the **entire** HTTP body — an HTTP POST body
*is* the payload; there is nothing else.

For **triggers**, the request envelope has dedicated structural slots — `references`
(destination, §4.1), `version`, `secrets`/`credentials` (auth, internal). The mapping must
**not** produce those. It produces only the "data fed in" slot, hence the field name
`inputs_fields`:

```text
WorkflowServiceRequest
├─ references / selector          ← destination   (from §4.1; NOT from inputs_fields)
├─ version, secrets, credentials  ← envelope/auth  (internal; NOT mapped)
└─ data: WorkflowRequestData
     └─ inputs   ◄──────────────── inputs_fields resolves into HERE (and only here)
```

So the asymmetry, stated exactly:

```text
webhooks:  payload_fields  →  the whole HTTP body
triggers:  inputs_fields   →  request.data.inputs   (a sub-field of the request)
```

Whether any *other* `data.*` sub-fields are mappable (`parameters`? `testcase`?) is an open
call (§6); the safe default is **inputs only**.

### 4.3 Deliveries (same pair, different fields)

Webhooks is a **two-table** domain: `webhook_subscriptions` (the standing config) **and**
`webhook_deliveries` (one audit row per attempt) — `WebhookDelivery` /
`WebhookDeliveryData{url, headers, payload, response, error}` (`types.py:156`), with routes
`/webhooks/deliveries`, `/{id}`, `/query` (`router.py:110`).

Triggers mirrors the pair: `subscriptions` **and** `deliveries`. A delivery row records one
inbound event being dispatched to its workflow — the by-reference destination, the resolved
inputs, and the outcome:

```text
WebhookDeliveryData   { url, headers, payload,                response{status_code, body}, error }
TriggerDeliveryData   { references (workflow), inputs (resolved inputs_fields), result,    error }
```

This is the right call (not "maybe"): a delivery record is needed precisely for the cases
where the workflow's own trace does **not** exist — dispatch that fails *before* invocation
(bad mapping, workflow not found, connection invalid) or is deduped/skipped. It is also the
retry and observability surface, exactly as `webhook_deliveries` is for the outbound side.
Full table/route symmetry in `mimics.md` § Triggers vs Webhooks.

---

## 5. What we reuse vs. what's new

| Piece | Status |
|-------|--------|
| Mapping field | **same mechanism, retargeted name** — `inputs_fields` (vs. `payload_fields`); maps `data.inputs`, not a whole body |
| Context shape `{event, subscription, scope}` + allowlist discipline | **identical** — define `TRIGGER_EVENT_FIELDS` like `EVENT_CONTEXT_FIELDS`; reuse `SUBSCRIPTION_CONTEXT_FIELDS` |
| Selector resolver (`resolve_json_selector`) | **reuse** — already in `agenta.sdk.utils.resolvers` |
| Recursive template walk (`resolve_payload_fields` → `resolve_target_fields`) | **reuse + rename** — promote from `core/webhooks/delivery.py` to the SDK under the neutral name `resolve_target_fields`, so both domains consume it (avoids triggers→webhooks import) |
| `event_types` filter | **same idea** — which provider event the subscription watches |
| Destination | **reuse a different primitive** — workflow `Reference`/`Selector` (the `/retrieve` shape) instead of `url/headers/auth_mode` |
| Mapping *target* | **different** — `inputs_fields` resolves into `data.inputs` only, not the whole request (webhooks maps the whole body) |
| Two-table domain (subscriptions + deliveries) | **same shape** — `subscriptions` + `deliveries`, mirroring `webhook_subscriptions` + `webhook_deliveries` |
| Delivery record fields | **different fields, same idea** — `references + inputs + result` vs. `url + payload + response` |

Net: **the resolver, the mapping mechanism, and the `{event, subscription, scope}`
context are reused/identical**, and like webhooks it is a **two-table** domain
(subscriptions + deliveries). The real differences all follow from the target being an
internal workflow: (a) the destination is a workflow *reference* (the `/retrieve`
`Reference`/`Selector`, not a by-value URL), and (b) the mapping field is `inputs_fields`
landing in `data.inputs`, not the whole body.

---

## 6. Open questions

- **Default mapping** — webhooks defaults `payload_fields` to `"$"` (whole context).
  Triggers feeding a *typed* workflow may want a stricter `inputs_fields` default (e.g.
  `"$.event.data"`) or require an explicit mapping before the subscription can activate.
- **Validation against the workflow's input schema** — should creating a subscription
  validate `inputs_fields`' resolved shape against the bound workflow revision's expected
  inputs? Webhooks has no downstream schema to check; triggers does — a new opportunity and
  a new failure mode.
- **Delivery retries** — webhooks has `WEBHOOK_MAX_RETRIES = 5` on the outbound leg. What
  is the retry policy for a failed *dispatch* (workflow invocation) recorded in
  `deliveries`, vs. relying on Composio's own inbound redelivery? (The `deliveries` table
  itself is decided — see §4.3.)
- **`TRIGGER_EVENT_FIELDS` contents** — which inbound-event keys to expose
  (`data`, `type`, `timestamp`, curated `metadata`); keep `ca_*`/secrets out.
- **Resolver location + rename** — `resolve_payload_fields` lives in the webhooks domain;
  promote it next to `resolve_json_selector` in `agenta.sdk.utils.resolvers` under the
  neutral name **`resolve_target_fields`** (it resolves a template into *a* target,
  whichever consumer's — whole body for webhooks, `data.inputs` for triggers), so triggers
  and webhooks both consume it from the SDK. The webhooks call site updates to the new name
  at that point — a docs-level decision now; the actual rename lands when the SDK promotion
  happens (during the triggers build).
