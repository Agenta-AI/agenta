# OpenRouter provisioning API: what is verified

Checked against OpenRouter's own API reference on 2026-08-02. Sources are listed at the
bottom. This answers question 1 of BRIEF.md and the model-restriction half of question 3.

## The request body for creating a key

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Identifier for the key |
| `expires_at` | ISO 8601 datetime, UTC | no | When the key expires. Other timezones are rejected. |
| `limit` | number | no | Spending cap in US dollars |
| `limit_reset` | `daily`, `weekly`, `monthly`, or null | no | Null means the cap never resets |
| `include_byok_in_limit` | boolean | no | Whether a customer's own uploaded keys count toward the cap |
| `creator_user_id` | string | no | Only for organization-owned keys |
| `workspace_id` | UUID | no | Defaults to the account's default workspace |

## Against Mahmoud's three requirements

**One key per user with a hard limit: supported.** `limit` is a dollar cap that OpenRouter
enforces on its own side. Nothing we run has to count anything for the cap to hold.

**No reset: supported.** Leave `limit_reset` null and the cap is a lifetime cap on that
key.

**About a one day expiry: supported natively.** `expires_at` takes an ISO 8601 UTC
timestamp. We do not have to run a deletion sweep to make keys expire, which is what I
was worried about. A sweep is still worth having for cleanup, but it is not what enforces
the expiry.

**Restricting which model the key may call: not supported.** There is no such field. The
create-key schema carries spending limits and administrative metadata only.

This last point needs care, because the public documentation is easy to misread.
OpenRouter does document a "model filter", and it does say "restrict the key to specific
models". But that filter applies to a **BYOK provider key**, meaning one of your own
OpenAI or Anthropic keys that you upload to OpenRouter so it can route through your
account. It controls when OpenRouter chooses to use that uploaded key. It does not
restrict what a minted OpenRouter API key is allowed to call. Anyone skimming the docs
will reach the wrong conclusion here.

## So what actually bounds the spend

Mahmoud's worry was right on the facts: we cannot pin the key to a model at OpenRouter.
Two other things bound it instead.

**The runner pins the model, at the configuration level.** On the custom OpenAI-compatible
path described in `repo-findings.md`, the runner writes a per-run `models.json` naming one
model and forces the model string to it
(`services/runner/src/engines/sandbox_agent/environment.ts:1032`). A user working through
the product cannot pick a different model for a trial run. This is not a security
boundary, because the sandbox is user-controlled and an agent with a shell tool can call
the base URL directly, but it covers the honest path.

**The dollar cap bounds the rest, and it makes the model question economically moot.**
Whatever model someone reaches, they cannot spend past the cap on that key. If the cap is
set at roughly $0.30, a user who forces their way onto an expensive model burns $0.30 and
stops. Ten thousand signups at $0.30 is $3,000, which is exactly the budget in the
original proposal, as a hard ceiling rather than an estimate.

The cost of a user reaching an expensive model is therefore not financial. It is that
they get a handful of messages instead of about thirty, which is a product experience
problem, not a spend problem.

## Sources

- [Create a new API key, API reference](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key)
- [Provisioning API keys](https://openrouter.ai/docs/features/provisioning-api-keys)
- [BYOK, bring your own keys](https://openrouter.ai/docs/guides/overview/auth/byok)

## Still unverified

- Whether there is a cap on how many keys one account may mint, or a rate limit on the
  provisioning endpoint.
- What margin OpenRouter adds over direct provider pricing for the candidate cheap models.
- Whether prompt caching survives the OpenRouter hop. This matters more than the margin,
  because the harness sends roughly 23.6K tokens of context per call.
- What happens to a run in flight when its key hits the cap or passes `expires_at`, and
  what error the harness surfaces.
