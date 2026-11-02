# Track D — bring-your-own secrets for sandboxes and gateway (BYOS)

Track D extends the vault — proven for LLM provider secrets — to **sandbox**
(Daytona, E2B) and **gateway** (Composio) secrets, and makes secret origin a
first-class billing fact so bring-your-own usage is zero-rated against the
wallet. Stacked on Track C (billing): the zero-rating gates C's debit sinks.

Companion design docs (big-agents-audit collection):
`monetization-integration.md` §3 (the full behavioral map: 3.0 prerequisite,
3.1 Daytona, 3.2 E2B, 3.3 Composio, 3.4 the `secret_origin` seam) and
`tiers-and-unified-wallet.md` §8. This spec is the build cut.

Terminology (absolute): a customer's provider key is a **secret**
("credentials" is reserved for Agenta's own auth — API keys, secret tokens,
access tokens). Origin values reuse the codebase's vault terms:
**`secret_origin: vault | local`** (`vault_secrets` = the customer's,
`local_secrets` = the platform's, per `vault.py`).

## Why this is billing work

- **BYOS = their infra, their bill.** A customer's own Daytona/E2B secret runs
  sandboxes in *their* provider org; their own Composio API key runs tools in
  *their* workspace. No external cost to us → **zero contribution** to
  `SANDBOX_DEBITS` / `GATEWAY_DEBITS` / `WALLET_DEBITS`.
- **BYOS is the escape valve for the prepaid wallet's month-1 UX**: bring your
  own provider secret and run immediately without topping up; the wallet only
  meters platform-secret usage.
- The same `secret_origin` primitive zero-rates BYOK LLM runs — design it once,
  apply to all three families.

## Components

### D0 — prerequisite: fix the secrets read surface

`GET /secrets/` returns plaintext secret material to any `VIEW_SECRET` caller,
and the agent path resolves connections straight through it (bypassing gates).
Before infrastructure secrets (account-level compute keys) enter the vault,
secrets must resolve server-side / over an internal-only route, never
enumerated wholesale to clients — and the agent path must go through that
gated, stamped resolution. **This is the first task; everything else builds on
it.**

### D1 — vault + resolver extension (Daytona first — the live provider)

- New `SecretKind` values for sandbox providers and the gateway provider key
  (same encrypted table).
- Resolver (`VaultConnectionResolver`) candidate kind that matches on
  **backend/provider**, not provider+model; resolved env
  (`DAYTONA_API_KEY`/`DAYTONA_API_URL`, …) travels the existing
  `ResolvedConnection.env` → `SessionConfig.secrets` → runner clear-then-apply
  channel; add the new keys to `KNOWN_PROVIDER_ENV_VARS`.
- The SDK evaluator runner's private vault→env mapping routes through the same
  resolver (no fourth copy of the mapping).

### D2 — `secret_origin` stamp (the shared seam)

- The resolver stamps `secret_origin: vault | local` (+ connection id) on the
  resolved connection; handler/runner propagate it into span attributes and
  the session record.
- Gating consults it pre-flight (platform → wallet gate applies; vault → skip).
  For the sandbox Layer-1 gate this needs the origin known **before** the quota
  check in the sessions router (reorder resolution vs gate, or a cheap org-has-
  BYOS-connection lookup).
- Track C's debit sink takes `secret_origin` and zero-rates `vault` runs —
  explicit (a zero row / early return keyed on origin), not implicit control
  flow, so the rule is auditable.

### D3 — E2B mapping (design-ahead; provider not runnable on mainline yet)

- `team_id → (organization, webhook_secret)` mapping table — required even for
  platform-key correctness (parsing `team_id` as our org UUID is a
  platform-only trick), mandatory for BYOS (events signed with the customer
  team's secret).
- Webhook self-registration at connection-save time using the customer's API
  key (`POST /events/webhooks`, per-connection minted secret).

### D4 — Composio per-org adapters + triggers

- Adapter construction (auth/catalog/tools/triggers — today module-level
  boot-time singletons on the platform key) moves behind a per-org factory
  with caching: resolve the org's vault gateway secret → adapter; fall back to
  the platform singleton. Mechanical but invasive: call sites need the org in
  hand.
- Triggers are the hard part: per-org trigger registration at
  connection-save time, and the inbound trigger webhook needs a
  workspace-id → org mapping verified against that org's webhook secret.
- Do NOT move user-level connected accounts into the vault — gateway
  `connections` rows (opaque `connected_account_id`, OAuth on the provider's
  hosted flow) are the complementary pattern and stay as they are. Only the
  org's own Composio **API key** is the BYO-gateway vault secret.

### D5 — Composio pricing research

How Composio bills (per call / execution / toolkit) → sets the
`GATEWAY_DEBITS` rate for platform-key usage and confirms what BYO-gateway
usage costs the customer directly. Output: a short findings note + the rate
table entry shape.

## Out of scope

The wallet itself (Track C), LLM BYOK sink changes beyond the shared
`secret_origin` primitive, metered-anyway BYOS accounting (zero-rated is the
default stance; per-org polling of customer Daytona orgs is explicitly
rejected for now).
