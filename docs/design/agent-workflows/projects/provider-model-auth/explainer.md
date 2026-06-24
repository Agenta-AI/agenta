# In plain words

A plain-language version of [design.md](design.md). The formal data structures stay there.

## The problem

When an agent runs, it needs a model and permission to call that model. Agenta picks the model
loosely and hands out permission bluntly.

Today you pick a model as one piece of text, like `gpt-5.5`. Agenta does not know which provider it
belongs to, so at run time it grabs every API key in your project vault and gives them all to the
agent. That carries four problems:

- You can store only one key per provider; a second key for the same provider is dropped.
- You cannot point an agent at a custom endpoint (Azure, Bedrock, a proxy), even though the vault
  already knows how to store one.
- The agent receives keys it never uses, which is wider exposure than the run needs.
- Subscription logins (a ChatGPT or Claude plan) do not fit, because they are not keys.

## The idea

Keep the model and its connection together in the agent config, as one thing.

1. **Which model.** A provider and a model, for example OpenAI and `gpt-5.5`.
2. **Which connection.** Which credential authorizes and pays for the call. This is part of the
   model choice, in the same place in the config.

A **connection** is a named credential: "OpenAI prod", "OpenAI sandbox", "Azure eastus". You can
keep several per provider, which is how multi-account works. When a run starts, Agenta turns the
model plus the connection into one thing: the single credential that run needs, and nothing more.

## We reuse the vault you already have

We are not building a new thing. A connection is not a new kind of object: a connection IS a vault
secret you already have. A plain provider key is a connection. A custom provider with its base URL
is a connection too. There is no new place to store keys, no new table, no new screen. The word
"connection" only names two things: how the config points at a secret, and the one credential we
hand the run after we look that secret up.

The same secret feeds everything. Say you saved a Bedrock custom provider in the vault. The model
hub uses it. Claude Code can use it. Pi can use it. It is the same single secret each time. The only
difference is how each one is wired up: the model hub turns it into LiteLLM settings, Claude turns
it into its Bedrock flag plus AWS variables, and Pi turns it into its Bedrock provider plus the same
AWS variables. Nobody makes a second copy.

The prompt path reads these secrets today. The agent path will read the same ones. Nothing about how
you store keys changes.

## The connection lives in the config, and stays portable

The connection is part of the config, so it travels with the agent. It stays portable because it
stores a name, not a database id. There are only two kinds of connection:

- **An Agenta connection**: Agenta holds the key and injects it. You can leave it unnamed or name
  one.
  - **Unnamed** means "the project default for this provider." That works in any project.
  - **Named** means a specific connection, stored by name. In another project, that name resolves to
    that project's connection of the same name. If there is none, the run stops with a clear message
    asking you to pick one. It never quietly uses a key for the wrong provider.
- **Self-managed**: the config says "the agent brings its own login." Agenta injects nothing. That
  works anywhere too.

There is no third "default" option to learn: the project default is just an Agenta connection with
no name.

One honest limit: a name is a role, not a frozen account. If two projects each have an "OpenAI prod"
connection holding different OpenAI keys, the name resolves to each project's own key. That is what
you want for "use my prod connection," and every run records which connection it actually used.

To try a different connection for a single test run, you change it in the config you send when you
test, the same way you test any config before committing it. There is no separate override.

## "Our stuff" versus "not our stuff"

An agent can get its credentials two ways:

- **Agenta-managed.** You saved a key in Agenta. Agenta injects it. This is how prompts work today.
- **Self-managed.** Agenta holds no key. The agent uses a login from somewhere else: a harness
  already logged in inside your own sandbox, an environment variable on your machine, or a cloud
  identity. You pick this when self-hosting or running a local backend.

Self-managed exists mainly for subscription logins. Claude Code and Codex can use your ChatGPT or
Claude plan, whose login lives in a file the tool rewrites every time the token refreshes. You
cannot paste a moving file into a vault and expect it to keep working. So Agenta injects nothing and
the agent uses its own login. Self-managed only matters for agents; prompts always use a stored key.

## What the playground shows

For agents we add a small set of controls next to the model: a provider, a model, its params, and
where the credentials come from (an Agenta connection, named or left as the project default, or
self-managed), plus a raw-JSON box for the exact value. The form also knows what each harness can
do, and it learns that from the harness itself. Each harness publishes its own list of reachable
providers (Claude Code reaches Anthropic only; Pi reaches OpenAI, Anthropic, Gemini, Mistral, Groq,
MiniMax, Together AI, and OpenRouter, plus Azure, Bedrock, and Vertex deployments). The form takes
that list, crosses it with the connections you actually have stored, and shows only the ones the
selected harness can use. Adding a custom endpoint stays on the existing secrets screen.

## Does this break prompts and completions?

No. They keep working, untouched. They read the same vault through their own reader. We add a
separate reader for agents and a resolve step that returns one credential instead of all of them.
The prompt path never calls it. Later we can move both onto the same step so you configure a
connection once; that is a separate, optional follow-up.
