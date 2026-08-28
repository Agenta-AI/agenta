# Follow-up issue draft: the vault read returns provider keys in cleartext

**Status:** draft, for filing outside the gateway-connection rework. Found during the live QA of
that rework on 2026-08-27. **Do not fix the endpoint in that PR.**

## Title

Vault: `GET /vault/v1/secrets` returns raw provider keys to any project API key holder

## What happens

`GET /api/vault/v1/secrets?project_id=<id>`, authenticated with an ordinary project API key,
returns each secret's stored material in full:

```
[{"slug":"openai-...","kind":"provider_key",
  "data":{"kind":"openai","provider":{"key":"sk-proj-…the whole key…"},"harnesses":["pi_core"]},
  "write_only":false,"value_status":{"configured":true}}]
```

No redaction, no preview, no separate scope. Reading the catalogue and reading the secrets is the
same call, so anything that lists secrets — a UI, a script, an agent looking up a slug — receives
the key material whether or not it needs it.

## The write-only path already exists and works

A secret created with `write_only` set comes back with the value withheld and a preview instead:

```
"write_only":true,"value_status":{"configured":true,"preview":"sk-****QAA"}
```

Verified on 2026-08-27 by creating a new provider key in the QA project and reading it back. So the
capability is present; the exposure is that it is per-row and opt-in, and a row created without it
returns raw material forever.

## Recommendation

1. The read endpoint should never return raw provider material, regardless of how the row was
   created. Return the preview shape for every secret and give the value its own explicit,
   separately-authorized path if anything genuinely needs it.
2. Backfill existing rows to the withheld shape rather than relying on how each was created.
3. Treat "can list secrets" and "can read secret values" as different permissions.

## Exposed key, and its real impact

The QA project's OpenAI provider key was returned in full during this QA session and is recorded in
that session's transcript. Impact is **low and bounded**:

- It is a QA-project key on the dev box, not a production credential.
- It was already exhausted — every run against it failed `You have no credits remaining` — so it
  had no spend capacity at the time of exposure and none since.

Rotate it anyway, because "the key was useless" is a property of this moment and not of the key.
The Anthropic key added later in the same session was created write-only and was never returned in
cleartext, so it does not need rotation on this account.

## How it was found

Looking up the create-request shape by reading an existing row, during unrelated work. That is the
ordinary way someone meets this endpoint, which is the point: no unusual access and no attack was
needed, just a normal developer action against a normal project credential.
