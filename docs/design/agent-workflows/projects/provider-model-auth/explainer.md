# What we are changing, in plain words

A plain-language version of [design.md](design.md), with the naming and structure from the
Codex review folded in. This page explains the idea, what it means for the playground, and
whether it touches prompts and completions. The formal data structures stay in
[design.md](design.md).

## The problem today

When an agent runs, it needs two things: a model, and permission to call that model. Agenta
handles the first and fumbles the second.

Today you pick a model as one piece of text, like `gpt-5.5`. Agenta does not know which
provider that text belongs to. So when the run starts, Agenta grabs every API key in your
project vault and hands all of them to the agent. The agent keeps the one it needs and
ignores the rest.

That works, but it carries four problems:

- You can store only one key per provider. A second OpenAI key gets dropped.
- You cannot point an agent at a custom endpoint (Azure, Bedrock, a proxy).
- The agent receives keys it never uses. That is wider exposure than the run needs.
- Subscription logins (a ChatGPT or Claude plan) do not fit, because they are not keys.

## The idea

Split the one fuzzy choice into two clear ones.

1. **Which model.** A provider and a model, for example OpenAI and `gpt-5.5`. This stays in
   the agent config. It is portable and describes intent, not secrets.
2. **Whose credentials.** Which account authorizes and pays for the call. This is not part of
   the agent's portable identity, so it does not live in the committed config. It rides the
   run instead: a tester pins an account on the request, and a deployed environment holds a
   default account. (An earlier draft put this on the workflow revision. We moved it off,
   because a revision gets exported and shared across projects, and a project-local account id
   would break the moment the revision is reused elsewhere.)

A **provider account** is a named credential: "OpenAI prod", "OpenAI sandbox", "Azure
eastus". You can keep several per provider. That is how multi-account works. When a run
starts, Agenta turns the chosen model plus the chosen account into one thing: the single
credential that run needs, and nothing more.

## "Our stuff" versus "not our stuff"

This is the part that was unclear. An agent can get its credentials in two ways.

- **Agenta-stored, our stuff.** You saved an API key in Agenta. Agenta injects it. This is
  exactly how prompts work today.
- **Self-managed, not our stuff.** Agenta holds no key. The agent gets its login from
  somewhere else: a harness already logged in inside your own sandbox, an environment
  variable on your machine, or a cloud identity.

Why does the second way exist? Coding agents like Claude Code and Codex support subscription
logins, your ChatGPT or Claude plan. That login lives in a file the tool rewrites itself
every time the token refreshes. You cannot paste a moving file into a vault and expect it to
keep working. So for those logins the only honest answer is this: Agenta injects nothing, and
the agent uses its own login. We call that self-managed.

Self-managed only matters for agents. Prompts and completions always use a stored key, so
they never meet this choice.

## What the playground shows

Today the model picker lets you see your configured providers, add a custom provider, and see
each provider's models. That stays.

For agents we add one small choice next to the model: where its credentials come from.

- **Use an Agenta account** (the default). Pick which account, or let the run use the
  project's default for that provider. This is today's behavior, plus the ability to name and
  choose among several accounts.
- **Self-managed.** Agenta injects nothing. A short hint says the sandbox or harness must
  already be logged in.

Adding a custom endpoint does not change. You still add a provider account that carries a
base URL.

For the first version we keep it minimal: provider, model, an optional account, a
self-managed toggle, and a raw-JSON box. The JSON box lets you send exactly what you want
while we build the real control.

## Does this break prompts and completions?

No. They keep working, untouched. Three reasons.

- Prompts and completions resolve their key through a different, older path that reads the
  same vault. We do not change that path, the vault storage, or the existing `/secrets` API.
- We add a new read-only view on top for agents (provider accounts) and a new resolve step
  that returns one credential instead of all of them. The completion path never calls it.
- Existing keys get a default account name through an additive backfill. No existing field
  changes meaning. The only behavior we replace is the agent's "grab every key" step, and
  that touches agent runs only.

Later we can move prompts and completions onto the same accounts, so you configure your
accounts once and both paths use them. That is a separate, optional step with its own
migration. It is not in this first stack.

## The names, old and new

The Codex review renamed most of the proposal. The vocabulary we are adopting:

| Old (first draft) | New |
| --- | --- |
| `ModelRef` (with a connection inside) | `ModelSpec` (provider, model, params only) |
| `Connection` | `ProviderAccount` (user term: "provider account") |
| the connection reference, inside the agent config | `ModelAccessBinding`, on the run (request override or environment default), not on the committed revision |
| `InjectionPlan` | `ResolvedModelAccess` (the resolved access contract) |
| `ConnectionResolver` | `ModelAccessResolver` |
| `SidecarAuth` | `RuntimeProvidedAuth` (user term: "self-managed credentials") |
