# Context

## Why this exists

The agent-workflows PR stack shipped a runtime that runs a coding harness as an Agenta
workflow. It got tools, tracing, sessions, and multi-harness support right. It did **not**
treat provider/model selection or credential injection as a designed concern. Those parts
were made to work for the demo and left as the weakest seam in the system.

Concretely, today (see [research.md](research.md) for file:line):

- The neutral `AgentConfig` carries a single bare string, `model`. There is no `provider`,
  no `base_url`, no notion of which account a key belongs to.
- At run time the service calls `resolve_harness_secrets()`, fetches the **whole** project
  vault over `GET /secrets/` (which returns API keys in plaintext, not redacted), and sets
  **every** provider key it recognizes as an env var on the harness. The chosen model never
  participates in deciding which key to inject.
- A project can hold only one usable key per standard provider. A second OpenAI key is
  silently shadowed. There is no multi-account story.
- Custom providers (Azure, Bedrock, Vertex, a self-hosted OpenAI-compatible endpoint) exist
  in the vault schema but the agent runtime ignores them. No base URL ever reaches a harness.
- OAuth subscription logins (a ChatGPT, Claude, or Gemini subscription) are handled ad hoc:
  Pi's `auth.json` is copied from disk on the sandbox-agent path, and Claude's OAuth token is only
  ever inherited from the sidecar's own environment. Nothing about this is modeled.

## What we want to be able to do

1. Select a **provider and a model** for a harness in a way that is harness-neutral and
   translates cleanly to Pi, Claude Code, and Codex.
2. Inject **only the credential the selected model needs**, not the whole vault.
3. Support **multiple accounts for the same provider** (two OpenAI keys, a prod and a dev
   Anthropic key) and let the run pick which account to use. Default to the one that
   matches the provider.
4. Support **custom providers / base URLs** (Azure, Bedrock, Vertex, OpenAI-compatible
   gateways, a proxy) for harnesses that can reach them.
5. Handle **OAuth subscriptions** correctly. The subscription credential file is rewritten
   by the harness at run time (token rotation). We must not store a frozen copy and expect
   it to keep working.
6. Support the **self-managed auth** case (a baked-in sidecar login). A user runs their own sandbox-agent sidecar with the
   harness already logged in (OAuth on an external volume on their machine). They select the
   provider with no secret stored in Agenta. The runtime injects nothing and the harness
   uses its own login.
7. Let an **SDK user bring their own secrets** at instantiation, or opt into "use Agenta's
   vault." Same port, two adapters.
8. Keep the playground change **minimal**: a small component to pick provider/model and a
   an account, plus a raw-JSON escape hatch so a tester can send exactly what they want now.

## The questions this design must answer

- What is the harness configuration for provider and model, and where does it live? (Answer
  in [design.md](design.md): a neutral `ModelSpec` in the committed agent config.)
- Which secret goes there, and where does the **mapping** live? It does not feel like part of
  the Agenta config. (Answer: a `ModelAccessResolver` port owned by our infra, not the config
  and not the harness adapter. The chosen account binds on the run, not the committed config.)
- Does the harness/config port need to know about accounts and the provider->secret mapping?
  (Answer: no. It stays account-unaware. It consumes a neutral `ResolvedModelAccess` contract.)
- How do we avoid sending everything every time? (Answer: model-scoped, least-privilege
  resolution; a service-side `resolve` endpoint instead of dumping the vault.)

## Non-goals (for the first stack)

- Rewriting the LiteLLM completion path for prompt workflows. The account model should
  eventually feed both, but the first stack targets the harness path and leaves completions on
  their existing path. See [design.md](design.md), "Relationship to LiteLLM."
- A full secrets-management product (rotation policies, per-secret keys, audit). We flag the
  weak `AGENTA_CRYPT_KEY` default but do not fix encryption here.
- Durable storage of rotating OAuth access tokens. We model OAuth subscriptions as
  self-managed (`source: runtime`, Agenta injects nothing), not as a vault-stored mutable file.
- Changing the playground's core UX. One small component plus a JSON escape hatch only.

## Constraints inherited from the codebase

- The SDK owns neutral ports and data contracts; the service plugs in Agenta adapters; the
  SDK must not import the service. ([../ports-and-adapters.md](../ports-and-adapters.md))
- New API code follows the domain folder shape in `api/CLAUDE.md`
  (`apis/fastapi/<domain>`, `core/<domain>`, `dbs/postgres/<domain>`), with typed DTO
  returns and domain exceptions.
- The `/run` wire contract is duplicated in Python (`utils/wire.py`) and TypeScript
  (`services/agent/src/protocol.ts`) and pinned by golden tests. Any wire change updates both
  sides and the tests in one PR.
