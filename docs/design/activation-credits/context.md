# Context: why we are funding new users' first messages

## The situation

A person signs up for Agenta cloud. After the signup survey they land on `/apps`,
which redirects first-time users into the onboarding playground. There they
describe the agent they want, or pick a template, and hit Create. The agent is
committed, a first prompt is seeded into the conversation, and at that exact
moment the product locks: the message input grays out with the placeholder
"Connect a model to start chatting…", and a yellow banner says "Connect
{provider} to run this agent with your own key." Until the user pastes an LLM
provider API key, nothing runs. The moment they do, the seeded prompt auto-sends;
the code comment for that behavior reads "Connecting the key IS the go-ahead."

So the product walks a new user all the way up to the payoff and then demands
they leave, create an account with OpenAI or Anthropic, generate a key, and come
back. Most people who hit a wall like this during their first five minutes do not
come back. This is the activation problem this project attacks: the single
largest point of friction sits exactly on the step we most need people to
complete, which is seeing their agent respond once.

The wall is not a backend limitation. It is one client-side boolean
(`gateActive`) that disables the composer whenever the project's key vault is
empty. The backend below it, however, currently has no safe way to fund a run
with our own key, and building that safely is where the real work is. The
research and design documents in this folder cover both halves.

## Why now

Two reasons, one internal and one competitive.

Internal: activation is the metric of the quarter. Signups are arriving and not
converting to a first successful playground message, and the key wall sits
directly on that step.

Competitive: Agenta now sells into the agent-platform market. Every AI-first
competitor in that market lets a new signup run a real agent immediately, on
credits the platform funds, with no key form anywhere in the first session. Only
the older workflow-engine incumbents still demand your own key, and their
first-session experience is visibly the weaker for it. Funded starter usage is
not a differentiator we could add; it is a gap we currently have. (Named
competitor analysis stays out of the repo by policy; research.md carries the
anonymized findings, and the named notes are available on request.)

## What we are building, in one paragraph

Every new cloud organization gets a small, one-time balance of free playground
messages, roughly thirty. While the balance lasts, playground runs execute on an
Agenta-owned key against one cheap model, and the user sees a quiet countdown.
When the balance hits zero, the existing connect-your-key moment appears, with
the user's typed message preserved and auto-sent once they connect. Users who
bring their own key never touch any of this. The trial exists to move the key
wall past the payoff moment, not to remove it.

## Goals

- A new user's first message sends and gets an answer with zero setup.
- The wall moves to after the aha moment and converts better there, measured by
  activation rate and key-connection rate.
- Total program cost stays bounded: $3,000 covers roughly 10,000 signups with
  hard worst-case limits per account.
- Everything reuses the existing entitlements and metering machinery where it
  fits, and what is new (the gateway, the grant, the reservation) is sized for
  an MVP while being the substrate later credit products extend.

## Non-goals for this iteration

- Earned credits (connect GitHub, finish the tutorial). Validated in the market,
  wanted later, designed for as a seam, not built now.
- Purchasable managed credits (reselling metered inference). Same: the ledger
  built here is what it would extend.
- Funding the classic prompt playground, evaluations, or any background
  execution. The trial funds interactive playground runs only.
- Any change for self-hosted deployments. This is cloud-only.

## Constraints that shaped the design

- **The runtime is user-controlled.** Playground agents execute in a Daytona
  sandbox where the user's instructions and tools decide what runs. Anything
  placed in that sandbox, including credentials, must be assumed readable and
  usable by the user. This single fact forces most of the architecture.
- **Agent runs are token-heavy.** Every LLM call replays roughly 23,600 tokens
  of harness context (system prompt, skills, tool definitions). Naive
  chat-message cost math is off by two orders of magnitude; all budgeting works
  from measured agent-run numbers.
- **MVP discipline.** Mahmoud's standing direction: reuse the entitlements
  architecture, do not build parallel systems, keep credits as abstract units
  rather than money, ship the simple case first without foreclosing the later
  ones.
- **In-flight work overlaps.** PRs #5223/#5277/#5278 (Daytona secret delivery)
  attack the credentials-in-sandbox problem and are part of this design's
  composition. PR #2957 built a first version of platform-funded usage whose
  metering half we reuse.

## Glossary

Terms the rest of this folder uses without re-explaining.

- **Playground / composer**: the agent chat surface; the composer is its message
  input box.
- **Vault**: the per-project store of the user's own provider API keys
  ("secrets"). "Vault empty" is what triggers today's wall.
- **BYOK**: bring your own key; the user pays their provider directly. Agenta's
  normal mode.
- **Self-managed connection**: a mode where the harness signs in with the user's
  own Claude/ChatGPT subscription instead of an API key; no vault key needed.
- **Harness**: the agent runtime (Pi and peers) that owns the system prompt,
  skills, and tools, and makes the actual LLM calls.
- **Runner / sandbox**: the service that executes agent runs inside Daytona
  cloud sandboxes; the sandbox environment is controlled by the user's agent.
- **Entitlements**: the EE quota system answering "may this org do X, and how
  much". Its counters are **meters**: rows incremented atomically in Postgres,
  with limits defined per plan (a **quota**). A quota with no period never
  resets; that is a lifetime counter.
- **Grant**: (this design) an append-only record giving an org a trial
  allowance.
- **Reservation**: (this design) the durable record that authorizes and charges
  exactly one funded run.
- **Gateway**: (this design) the small Agenta-side proxy that holds the real
  provider key and forwards funded model calls under budget enforcement.
- **Daytona Secrets**: Daytona's mechanism where a sandbox env var holds an
  opaque placeholder and Daytona's egress proxy substitutes the real value only
  into HTTPS requests toward an allowlisted host.
- **Responses API**: OpenAI's agent-native API surface (successor to plain chat
  completions for tool-using workloads); relevant because the gateway must speak
  it.
- **Prompt caching**: provider-side reuse of a repeated prompt prefix at a
  fraction of the input price; our replayed 23.6K harness context makes this the
  dominant cost lever.
