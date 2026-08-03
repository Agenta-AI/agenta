# Docs content map: the agent-platform docs

Working plan for the documentation on PR #5517. Source for the product content is
Mahmoud's brain dump of 2026-07-30, recorded below and sorted into the four Diataxis
modes. Positioning wording comes from `README.md`.

Scope of this pass: the front door and everything a user needs to understand and build an
agent. Triggers and automations are a later pass. Self-hosting, administration, and the
API reference are out of scope.

## The problem this pass solves

The restructure archived the previous product's docs as version 1.0, but the front door
still teaches that product.

- `getting-started/01-introduction.mdx` describes prompt management, evaluation, and
  observability.
- `getting-started/02-quick-start.mdx` walks the reader through creating a prompt,
  building a test set, running an evaluation, deploying a prompt, and fetching it from the
  SDK. It never mentions agents.

A reader is told Agenta is a workspace for agents and is then taught to manage prompts.

## The one idea the docs have to land first

In ChatGPT you get a prebuilt general agent that already works for everything. In Agenta
the instructions start empty and you build a custom agent for a job. Every concept page
below exists to serve that difference. If a reader does not get this, nothing else lands.

## How the four modes divide this material

Diataxis splits on two axes: study versus work, and skill versus knowledge.

- **Explanation** answers "what is this and why does it work this way". The reader is
  studying, not building. Most of the brain dump is explanation.
- **How-to** gets a reader who already knows what they want from where they are to done.
  Actions only, no teaching.
- **Reference** is what someone looks up mid-task. Dry, complete, no narrative.
- **Tutorial** is one guaranteed-success linear run for someone learning. Exactly one of
  these: the quick start.

## Explanation pages

### E1. What an agent is in Agenta

The spine. Every other page links back to it.

- ChatGPT ships one general agent. Agenta starts empty and you build a custom one.
- An agent is a configuration plus a harness plus a model.
- The parts, each linking to its own page: instructions, tools, skills, permissions,
  files, harness and model.

### E2. Instructions (`AGENTS.md`)

- What it is. The first thing sent to the agent at the start of every session. Harnesses
  call this the system prompt. Agenta calls the file `AGENTS.md`.
- Why it exists. It is the context you want guaranteed present on every single turn, not
  context the agent might or might not go read from a file.
- A worked example: a marketing agent. Who I am, what the company does, how I want it to
  talk to me, the problems I want help with.
- The cost. Every token here is resent on every turn, so a long identity is a recurring
  bill. This is the tension that shapes everything else.
- How it grows. Start small. Add one line each time the agent gets something wrong.
- Tone belongs here. Left alone, agents write in a voice you may not want.

### E3. Tools

- A tool is one action, not a whole product. Not "GitHub", but "create a GitHub issue"
  and "read a GitHub pull request".
- The agent sees each tool's name and description, and calls the ones that are relevant.
- Where tools come from: built-in integrations, and MCP servers.
- What an MCP server is, in two or three sentences, and why you would add one.

Out of scope for now: using other agents as tools. Not ready.

### E4. Skills

- A skill is a recipe or a short handbook that tells the agent how to do one kind of
  thing: write a PDF, run a particular analysis.
- The difference from instructions, which is the whole point: a skill is **not**
  preloaded. At the start of a session the agent sees only the skill's name and
  description. It loads the body only when it needs it.
- Therefore the description must say **when** to use the skill. That sentence is what
  makes it fire.
- This is how you give an agent a lot of capability without paying for it every turn.
- Skills come from the wider ecosystem or you write your own. Quality out there varies.

### E5. Files: session folder and agent folder

- The session folder is scratch space for one chat. Downloads land here. It goes away
  with the session, and a new chat cannot see it.
- The agent folder is shared by every session of that agent and persists.
- The pattern that makes this useful: write what the agent learns into the agent folder,
  then point at it from `AGENTS.md` ("the index is here", "to do X, read this").
- Nested `AGENTS.md`. Put one inside a subfolder and the harness reads it when the agent
  works in that folder. A `twitter-ads` folder can carry its own rules.

### E6. Harness and model

- A large language model does one thing: you send it messages, it returns a message.
- A harness drives the model. When the model says it wants to call a tool, the harness
  calls it and feeds the result back so the model can continue. It also handles
  compaction and loading instructions.
- Agenta supports Claude Code and Pi today.
- Three separate choices: which harness, which model, and which credential serves that
  model (the provider directly, your own proxy, or a cloud like AWS).

### E7. The context budget

Possibly a section inside E1 rather than its own page. Decide when writing.

Everything competes for one window. Instructions are always loaded. Skills load on
demand. Files are read on demand. This single idea explains why instructions stay short,
why skill descriptions matter, and why the agent folder exists.

### E8. Versions

Each configuration change is committed, so an agent has a history you can review and
compare.

## How-to guides

Each is a goal, not a feature. Actions only.

| # | Guide | Notes |
|---|---|---|
| H1 | Create an agent by chatting with it | The main path. Open the playground, say "be my marketing coworker", answer its questions. Covers the build kit: the agent discovers tools, edits its own configuration, requests a connection, and asks you questions in the UI. |
| H2 | Improve an agent's instructions over time | Add a rule after a bad run. Keep it short. Set the tone. |
| H3 | Give an agent a tool from a built-in integration | Includes connecting the account. |
| H4 | Add an MCP server | |
| H5 | Add an existing skill | Drag and drop a folder or a zip. |
| H6 | Write your own skill | The description is the hard part, because it decides when the skill fires. |
| H7 | Control what an agent may do on its own | Permission modes and approvals. |
| H8 | Give an agent a knowledge folder that survives sessions | Agent folder, plus nested `AGENTS.md`. |
| H9 | Choose the harness, model, and credentials | |
| H10 | Review and roll back a configuration version | |

## Reference pages

Written last, once the concepts settle.

- Agent configuration fields: every field, its type, and its default.
- Harnesses, and what each one supports.
- Models and providers.
- Permission modes.
- File locations and their lifetimes.
- Where `AGENTS.md` files are read from, and in what precedence.

## Tutorial

One page: the quick start. Linear, no branches, guaranteed to succeed.

Blocked on one decision: what the first agent should do. It has to feel useful, finish in
a few minutes, and not require connecting a work account like Gmail or Slack on the first
run.

## Writing order

Concepts first, because they fix the vocabulary every other page uses.

1. E1, what an agent is. Everything hangs off it.
2. E2 to E6, one page at a time.
3. The quick start, once the first-agent decision is made.
4. How-to guides.
5. Reference.

## Facts to verify before writing

Taken from the brain dump and not yet checked against the product. Each needs confirming
in the running app or the code before it appears on a page.

- Where the playground build kit is turned on, and its exact name in the UI.
- What the build kit actually lets the agent do.
- How skills are added, and which formats are accepted.
- The exact permission modes and their names.
- The real paths and lifetimes of the session and agent folders.
- Whether nested `AGENTS.md` files are read automatically, and by which harnesses.
- What the configuration history is called in the UI.

## Open questions for Mahmoud

1. **Composio.** You said not to name it. The README names it, and it is in the current
   draft of the introduction. Which way do you want it in the docs?
2. **Codex.** Not shipped, PR open. Leaving it out until it lands. Confirm.
3. **Competitor comparison.** The README has a "How Agenta compares" section naming other
   products, and the launch video's own title names one. Do you want that section in the
   docs?
4. **The first agent** in the quick start. What should it do?
