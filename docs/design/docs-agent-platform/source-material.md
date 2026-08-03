# Source material: what Agenta is and how it works

Recorded from the founder on 2026-07-30. This is the content the documentation turns into
pages. Treat it as true. Do not re-litigate it. Where a UI label is needed, take it from
`product-facts.md`, not from here.

## The framing that matters most

ChatGPT ships a prebuilt general agent that already works for everything. In Agenta the
instructions start empty. You build a custom agent for a job.

## Instructions

The instructions are the agent's identity. Harnesses call this the system prompt. In
Agenta the file is `AGENTS.md`. It is the first thing sent to the agent at the start of
every session.

Why it exists: it gives the agent context about what you are trying to do and achieve.
For a marketing agent you would put in who you are, what the company does, how you want
it to talk to you, and the problems you want help with. You want that context guaranteed
present every time, not sitting in some file the agent may or may not go and read.

The tension: you do not want a large identity, because those tokens are sent on every
turn, so a long one is a recurring cost.

How it grows in practice: start simple. Each time a task goes wrong, add an instruction
("do not do this"). Almost everyone ends up including how they want the agent to talk to
them, because the default voice of most agents is not what you want.

## Tools

A tool is an action the agent can take. Tools are the integrations in Agenta.

They are defined at the level of an action, not a product. Not "GitHub", but "GitHub read
this" and "GitHub write that". When the agent runs it sees the tools it has, each with a
description of what it does, and it calls the ones that are relevant.

Agenta has hundreds of built-in integrations. You add them to your agent and the agent
gains that capability.

The other way to add integrations is MCP servers, which let you connect to other
platforms.

Not documented yet: using other agents as tools. Not well done.

## Skills

A skill is a recipe, or a small handbook, that tells the agent how to do something.
Examples: how to write a PDF, how to run a particular analysis.

Skills are similar to the instructions in `AGENTS.md`, with one crucial difference: they
are not fully loaded. When a session starts the agent sees only the skill's name and
description, not its body. What you want in that description is when to use the skill.

That is what keeps the context small. You can have many skills without the agent reading
them all. It loads one when it needs it.

You can find a lot of skills on the internet. Some are slop, some are very valuable. You
can use any of them by dropping the folder or the zip into Agenta. You can also write your
own.

## Permissions

You give the agent a default permission: allow reads, allow everything, ask, or deny
everything. When it is set to ask, the agent asks you for an approval before going ahead.

## Harness and model

An agent is two things underneath.

A large language model does exactly one thing: you send it a message or a list of
messages, and it answers. That is all it does.

A harness is what drives the model. If the model says it wants to call tool X, the harness
calls tool X and returns the answer so the model can continue its work. It also handles
other things: compaction, how to manage the instructions, how to manage `AGENTS.md`.

Agenta ships with Pi and Claude Code. You select a harness, then the model that runs with
it, then the credential, which is where the model runs. You can use the same model from
the provider directly, from your own proxy, or from a cloud like AWS.

## Files

Each agent has access to two folder scopes.

The session folder belongs to one chat session. It is temporary. If the agent downloads
files they land there for that session, and when the session ends they go away. Open
another chat and that session does not exist.

The agent folder is shared by all sessions of that agent, and it persists.

Use these files as context for the agent. Write things there. A good practice is to write
things into the folder and then point at them from the instructions: check the index, or
if you want to do this, look here. Over time the instructions become a map of where
things are.

You can also put `AGENTS.md` files inside subfolders. When the agent works in that folder
the harness reads them automatically. So if it starts working on a project under a
`twitter-ads` folder, it picks up that folder's instructions and knows how to handle it.

An agent can have many sessions.

## Versions

The agent configuration is versioned. Each change can be committed, so an agent has a
history.

## How you create an agent

You do not fill in forms. You chat.

The moment you open Agenta you get the playground with all the configuration. You just
tell the agent what you want: "I want you to be my marketing coworker". It then asks you
questions about what you want and what it should do.

The agent can change itself. Under advanced there is an option called the playground build
kit. It gives the agent extra capabilities while you chat with it in the playground:

- It can discover tools. Say you want to use GitHub, and it checks whether it has access
  to GitHub and adds those tools to its own configuration.
- It can change its own configuration.
- It can request a connection, meaning it asks you to connect an app.
- It can ask you questions through a UI.

So the normal way to work in Agenta is that you do not change these things yourself. You
ask the agent to make the changes. It still makes sense to be able to see the versions and
improve the agent over time.

The usual progression: create an agent for a topic, for example marketing, before going
into sub-agents. Then add skills to it, build a wiki of how it works, and build ways of
working with it.

## Automations

A later topic, not yet dictated in detail. Automations run on a schedule or when an event
happens in a connected app.
