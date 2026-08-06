# Agent Workflows: Flows, User Stories, and Required Capabilities

Brainstorm scratch. Goal: list the flows from the user's point of view, then the
capabilities the system needs to support each one. Milestone/scope assignment is
left open. Fill the **Scope** line per flow once we decide.

Each flow has:
- **User story** (what the user does and gets)
- **Required capabilities** (what the system must provide)
- **Open questions / risk**
- **Scope** (TBD: which milestone/level)

Three cross-cutting concern axes show up repeatedly, so they get their own section
at the end: **Abstraction**, **Security/Auth**, **Triggers/Runtime**.

---

## Flow 1 — Create an agent from my IDE and chat with it ("chatty chat")

**User story.** From Claude Code or Cursor (or any IDE), using my Agenta skills, I
create an agent. There may be a key involved. I just create it and I'm done. Then I
open the Agenta playground and chat with it.

**Required capabilities.**
- A skill (in the IDE) that creates an agent config in Agenta.
- Auth from the IDE to Agenta (the "key").
- Tools available to the agent come from Composio.
- A skill that fetches the list of available tools and selects the ones that make
  sense for this agent. (Shared by every flow below.)
- Playground can load an agent config and run a chat session against it.

**Open questions / risk.** How much of the agent does the skill author vs. the user?
What does "done" mean — config persisted, ready to run?

**Scope.** TBD (this is the baseline / simplest flow).

---

## Flow 2 — Triggered agent (event-driven)

**User story.** I create an agent that fires on an event. Prototypical example: a
message arrives in Slack, the agent reads it, does something, and answers.

**Required capabilities.**
- Everything in Flow 1 (created from IDE, Composio tools, tool-selection skill).
- An event trigger: an external event (Slack message) starts an agent run.
- The trigger payload (the message) flows into the run as input.
- The agent can act back on the source (answer in Slack) via a Composio tool.

**Open questions / risk.** Where does the trigger live (Composio webhook, our
webhook layer)? How is the run associated back to the agent config?

**Scope.** TBD.

---

## Flow 3 — Scheduled agent (cron)

**User story.** I create an agent that runs every day, does something, and maybe
writes the result to Slack or somewhere else.

**Required capabilities.**
- Everything in Flow 1.
- A schedule/cron trigger that starts a run on a cadence.
- The run has no human watching it (unattended). See Flow 7 — HITL has to keep
  working when nobody is there.
- Output delivery to an external destination (Slack, etc.) via a Composio tool.

**Open questions / risk.** Same unattended-run concern as Flow 7. Where does the
schedule definition live?

**Scope.** TBD.

---

## Flow 4 — Run with a Claude Code subscription (local + self-hosted + cloud)

**User story.** I want to use my Claude Code subscription to run and debug these
agents, both locally and when self-hosting. I want the same triggers and
capabilities as above, just powered by my Claude subscription.

**Required capabilities.**
- Cloud: use your (cloud) subscription. There is a tutorial path for this.
- Self-hosted: same, powered by the subscription.
- Local: a local backend to run agents on your machine. Not a hard requirement, but
  useful and fairly easy to do.
- Auth model that carries the Claude Code subscription credential into the runtime.

**Open questions / risk.** Subscription OAuth vs. API key (we currently bake Pi but
never bake Claude Code; Claude installs at runtime and uses API-key auth, not
subscription OAuth — see sidecar licensing notes). How does a subscription credential
reach the sandbox safely?

**Scope.** TBD.

---

## Flow 5 — Agent with non-Composio (MCP) tools that need their own auth

**User story.** I want an agent whose tools are not Composio tools. They are MCP
tools, and they need some authentication of their own.

**Required capabilities.**
- MCP tool support in the runtime (alongside Composio/gateway tools).
- A way to authenticate to those MCP servers (per-server credentials).
- Tool taxonomy that distinguishes Composio/gateway tools from MCP tools.

**Open questions / risk.** Where do MCP server credentials live and how are they
injected per run/per user? MCP is currently claude-only in the matrix.

**Scope.** TBD.

---

## Flow 6 — Filesystem read/write within a round

**User story.** Within a single round, the agent should be able to read and write
(files).

**Required capabilities.**
- A working filesystem in the runtime/sandbox the agent can read and write.
- Persistence scope: at least within one round. (Across rounds = open question.)

**Open questions / risk.** Does state persist across rounds or only within one? What
is the sandbox's filesystem lifecycle?

**Scope.** TBD.

---

## Flow 7 — Human-in-the-loop permission requests

**User story.** The agent asks the frontend for permission before doing something.
The hard part: these permission requests need to work even when nothing is open. If
I closed the tab, or it is a scheduled/unattended agent, there still has to be a way
to deliver my answer back to the agent.

**Required capabilities.**
- Agent can raise a permission/approval request mid-run.
- The frontend can present it and collect the answer.
- A **global / durable** approval channel: the request and its answer are not bound
  to an open session. They survive a closed tab and apply to scheduled runs.
- Today's only workaround: open the trace from Observability and rerun it in the
  playground. We want better than that.

**Open questions / risk.** This is the central HITL design problem. How does an
unattended run park, notify, and resume on an answer? Where is the pending-approval
state stored? How does the user get notified (the run is async)?

**Scope.** TBD (likely a higher milestone — this is the hard one).

---

## Flow 8 — Bring-your-own API key in cloud (bundle authentication)

**User story.** When I use Cloud, I want the agent to use my own API key, which I can
set up. This is the "bundle authentication" path.

**Required capabilities.**
- Cloud users can register their own provider API key.
- Runs use the user's key instead of a platform key.
- Ties into the provider/model/auth redesign (ModelRef in config, Connection in
  vault, resolver injects per request, per-user always per-request never global).

**Open questions / risk.** What is "bundle authentication" exactly — a set of keys
bundled per user/project? Reconcile with the Connection/vault model.

**Scope.** TBD.

---

## Flow 9 — Open a trace and talk to the agent so it updates its own config

**User story.** I open a trace and talk to the agent, and through that conversation
it updates its own configuration. A skill to update your configuration would be nice.
That would be a gateway tool, defined as such.

**Required capabilities.**
- From a trace view, start a chat session with the agent.
- A "self-configuration" capability: the agent can edit its own agent config.
- This capability is a **gateway tool** (defined as a gateway tool in the taxonomy).
- Config writes flow back to the stored agent config and take effect on next run.

**Open questions / risk.** Guardrails on self-edit (what fields can it change?).
Versioning of config edited this way.

**Scope.** TBD.

---

## Flow 10 — Create an agent in the UI and grow it through chat

**User story.** Instead of starting from the IDE, I create an agent in the UI and
start chatting with it. Over time, through that interaction, I build up the skills
and MCPs it needs to do its job. The agent grows incrementally rather than being
fully authored up front.

**Required capabilities.**
- Create an agent config directly in the UI (no IDE round-trip).
- Chat with it immediately, before it is "complete".
- Add skills and MCP servers to it incrementally, from the UI, over multiple
  sessions.
- This is the UI-first, iterative counterpart to Flow 1 (IDE-first, author-then-run).
  Shares the tool-selection capability but drives it from the UI.

**Open questions / risk.** How does the agent's config evolve safely across many
edits (versioning)? Overlaps with Flow 9 (self-updating config) — is "grow it
through chat" the user editing, the agent editing itself, or both? When do secrets
get set up (see cross-cutting note below)?

**Scope.** TBD.

---

## Cross-cutting concerns

These show up across multiple flows. Worth deciding once, applying everywhere.

### Abstraction
- **Tool-selection skill** (Flows 1, 2, 3): fetch the available tool list and pick
  the right ones. Shared building block for every "created from IDE" flow.
- **Tool taxonomy**: Composio/gateway tools vs. MCP tools vs. builtin (filesystem)
  vs. client/self-config gateway tool. Each flow leans on a different part.
- **Create-from-IDE skill**: the common entry point for Flows 1-3.
- **Runtime/harness**: in-process Pi, Rivet local, Rivet Daytona, Claude Code. Which
  flows require which runtime (e.g. subscription -> Claude Code harness).

### Security / Auth
- **IDE -> Agenta key** (Flow 1).
- **Claude Code subscription credential** into the runtime (Flow 4).
- **Per-MCP-server auth** (Flow 5).
- **BYO API key / bundle auth in cloud** (Flow 8); per-user, per-request, never
  global.
- **Approval authority**: who can answer a permission request, and how that answer
  is authenticated when delivered out-of-band (Flow 7).
- **When do secrets get set up?** (applies to every authoring flow, both IDE-first
  Flow 1 and UI-first Flow 10). At what point in the lifecycle does the user provide
  secrets / API keys / connection credentials — at create time, on first run, lazily
  when a tool first needs one, or when the agent is promoted to triggered/scheduled?
  The timing differs by entry point (IDE skill vs. UI) and by trigger type (an
  unattended scheduled run cannot prompt for a missing secret at run time). Needs a
  consistent answer across flows.

### Triggers / Runtime
- **Manual / playground chat** (Flows 1, 9).
- **Event trigger** (Flow 2): Slack message in -> run.
- **Schedule / cron trigger** (Flow 3): daily run.
- **Unattended runs** (Flows 3, 7): no human watching; HITL and notifications must
  still work.
- **Local backend** (Flow 4): run/debug on your machine.

---

## Milestone assignment (to fill in)

| Flow | Title                                   | Scope / Milestone |
|------|-----------------------------------------|-------------------|
| 1    | Create from IDE + chat in playground    | TBD               |
| 2    | Triggered agent (Slack in -> answer)    | TBD               |
| 3    | Scheduled agent (cron)                  | TBD               |
| 4    | Claude Code subscription (local/cloud)  | TBD               |
| 5    | MCP tools with own auth                 | TBD               |
| 6    | Filesystem read/write within a round    | TBD               |
| 7    | HITL permissions (global/durable)       | TBD               |
| 8    | BYO API key in cloud (bundle auth)      | TBD               |
| 9    | Open trace -> agent self-updates config | TBD               |
| 10   | Create in UI + grow skills/MCPs via chat | TBD               |
