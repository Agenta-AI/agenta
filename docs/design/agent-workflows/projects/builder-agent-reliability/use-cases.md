# Use cases

Eight use cases, agreed with Mahmoud 2026-06-30, ordered so each one adds exactly one new kind
of difficulty over the last. Each entry: what it is, what it specifically tests, what it needs
(connections, projects, anything Mahmoud has to set up first), and notes from the conversation
that scoped it.

## 1. Text summarizer

**The agent:** takes a text and produces a summary of it.

**What it tests:** the absolute basics — can the subagent create an agent on Agenta, set its
identity/instructions correctly, and commit a working revision. No tools, no skills, no
triggers, no connections. Mahmoud's framing: "something really stupid where the agent just
needs to write to an agent's identity."

**Needs:** any OSS project and an API key for it. No connections.

**Role in the project:** the loop's own "hello world." If this round is clean, the lab-folder
mechanics (instruction file, subagent isolation, artifact saving, independent verification) are
proven and every later use case can build on them without re-litigating the basics.

## 2. Style / writing editor

**The agent:** reviews or edits writing using style-editing best practice (drawn from research —
Mahmoud's example: "from five books").

**What it tests:** skill-authoring, not just instruction-editing. The agent under construction
needs its own `SKILL.md` describing the style-editing practice, created and attached as part of
its configuration. The subagent therefore needs to know, up front, what makes a good `SKILL.md`
on Agenta (the format, the frontmatter, the body conventions) — that's lab-instruction content,
not something to leave it to discover.

**Needs:** no connections. Same project as use case 1 works.

**Note on roles:** the *experimenter* subagent (mine) never uses Agenta's skill system for
itself — its own instructions stay inline in the lab folder. The *target* agent (the style
editor) is the one that gets a real Agenta skill. Don't conflate the two.

## 3. Self-reflecting agent (trace annotation)

**The agent:** after a conversation, reflects on it and annotates its own traces.

**What it tests:** whether the subagent finds and correctly uses an internal capability it
wasn't told about in detail — there is a tool for annotating an agent's own traces, and part of
this round is whether the subagent locates and wires it. Per the standing rule "hint, don't
bootstrap from zero," the lab instructions should say plainly that such a tool exists, rather
than testing pure cold discovery — the goal is optimizing a path that starts from a reasonable
instruction, not proving discovery is possible from nothing.

**Needs:** no external connections. Same project as use case 1 works.

## 4. GitHub-connected lookup

**The agent:** something small that uses an existing GitHub connection — Mahmoud's example: an
agent that looks up the user's own GitHub username.

**What it tests:** the first use case with a pre-existing connection. The subagent has to find
the right tool name for a GitHub read action and configure the agent with it — not discover the
connection flow (the connection already exists), just use it correctly.

**Needs:** a project with a GitHub connection already created. Mahmoud will set this project up
and hand over its API key.

## 5. PR review / QA

**The agent:** reads a pull request and reviews or QAs the change.

**What it tests:** working entirely over the API with no filesystem — there is no clone, no
local checkout, so the agent has to review and reason about a diff it can only fetch, never
download in the traditional sense.

**Needs:** the same GitHub connection as use case 4 (broader scope: reading PR diffs/comments,
not just profile lookups).

## 6. Connection round-trip

**The agent:** needs an integration that is deliberately **not** connected yet.

**What it tests:** the "ask the human" path. The subagent must notice the missing connection,
ask Mahmoud to create it, and wait — not guess, not silently skip the step, not fail without
explanation.

**Needs:** a second project, deliberately missing a connection the use case requires (Mahmoud:
"I can create a project where I have GitHub and Slack connected, another one where I don't").
Which integration is "missing" is whatever's convenient for Mahmoud to leave out.

## 7. Trigger creation and testing

**The agent:** creates a trigger (schedule or subscription) for itself.

**What it tests:** the full trigger lifecycle done right: check whether the connection a
subscription needs already exists (ask first if not, per use case 6's path), create the trigger,
then **prove it works** rather than just claim it. Where the action is cheap and immediate (for
example firing a subscription test and reading the delivery log), the subagent should actually
do that. Where it can't be tested in-session (a schedule that fires hours from now), it should
say so honestly and report what it verified instead (config matches what was asked, connection
state is ready) rather than imply it confirmed something it didn't.

**Needs:** depends on the trigger chosen — a schedule needs no connection; an event subscription
needs whichever integration's connection is required. Reuse use case 4/5's connected project for
a connected version of this test, and use case 6's project to test the "ask first" path inside a
trigger flow specifically.

## 8. Telegram bot

**The agent:** a bot that listens on Telegram and replies in the same thread.

**What it tests:** the hardest combination so far — a trigger, same-thread/session continuity
across replies, and a one-time piece of *external* setup (a Telegram bot token via BotFather)
that the agent cannot do for the human; it has to explain clearly how Mahmoud does it himself.

**Needs:** Mahmoud to set up the Telegram side (bot token) and tell the lab what's available, or
the subagent walks him through it live as part of the round. Marked explicitly as the last use
case to attempt — Mahmoud: "that would be actually maybe the last thing I would ask for, the
hardest thing."

## 9. GitHub → Slack digest (capstone, added night 2)

**The agent:** twice a day, checks what changed in a GitHub repo (recent issues, commits,
discussions), writes a styled digest, and posts it to a Slack channel.

**What it tests:** everything at once, and it is the exact case Mahmoud first saw the live agent
fumble — multiple gateway tools (3 GitHub reads + 1 Slack write), a report style, and a
twice-daily cron with a real local-time → UTC conversion. The connection round-trip is skipped
(both connections exist), so this isolates the *assembly* problem: can the builder wire several
tools, compose them, schedule itself, and verify, without wandering. This is the prize; if the
kit makes this easy, it makes the whole initiative easy.

**Needs:** the project's GitHub + Slack connections (both set up by Mahmoud, night 2).

## Connections (set up night 2)

The live project now has **GitHub** (`github-08f`) and **Slack** (`slack-1vh`) connected, so
every GitHub/Slack case (4, 5, 7, 9) runs end to end. Notion and Telegram are deliberately *not*
connected — they are the `needs_auth` targets for the stop-and-ask cases (6 and 8).

## What's still open

- Exact lab-folder isolation mechanism for keeping the subagent from inheriting this repo's
  `AGENTS.md`/`CLAUDE.md` context (see `plan.md`, "Who does the building").
- Which local stack/project/API key starts use case 1 (see chat for the live question).
- Whether use case 6's "missing connection" should be GitHub, Slack, or something else —
  Mahmoud's call when he sets the project up.
