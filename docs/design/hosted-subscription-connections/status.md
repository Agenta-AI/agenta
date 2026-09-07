# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Research and candidate implementation plan updated September 7, 2026 for ChatGPT and SuperGrok
  onboarding.
- The planning workspace and interactive architecture walkthrough are ready for review.
- No implementation changes have been made.
- Self-hosted subscription execution and sanitized status reporting already exist in the codebase.
- Hosted per-user runner selection and browser connection onboarding do not exist.
- Codex exposes a structured device-login API through `codex app-server`.
- Grok Build exposes device login and ACP inference, but its public documentation does not expose a
  machine-readable login-control API.
- Both designs need an integration proof that model-started shell and file tools cannot read the
  mounted authentication home while the parent harness can still refresh it.

## Provider approval update (founder-confirmed, 2026-09-04)

Mahmoud reports written confirmation from every reviewed provider except Google Gemini and
Anthropic. The stated condition is that each cloud user connects and spends their own contract.
This is a founder-provided fact and outranks the public-terms reading in provider-policy.md. I have
not personally seen the written confirmations. Two follow-up items remain:

- Store each written confirmation and record any per-product limits it sets (for example, whether
  Qwen or Z.AI approval still restricts unattended schedules).
- Encode "own contract" as a hard isolation guarantee, not a policy note. See plan.md.

## Blocked products after the update

- Google Gemini consumer and Code Assist OAuth. No approval. Offer Gemini API keys or Vertex only.
- Anthropic Claude Pro or Max OAuth. No approval. Offer Anthropic API keys or cloud credentials.

## Decisions needed before implementation

1. Confirm that the first release allows only the connecting user to spend the connection and only
   for interactive turns.
2. Confirm one active run per subscription connection for the first release.
3. Obtain a supported machine-readable device-login contract from SpaceXAI, or accept a pinned Grok
   CLI terminal parser as a temporary dependency.
4. Approve one encrypted persistent volume per connection for the first release.
5. Approve the main FastAPI API as owner of public connection records and user checks, with private
   login operations on the runner.
6. Decide who operates hosted runners and encrypted authentication storage.
