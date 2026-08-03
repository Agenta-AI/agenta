# Documentation tree

The proposed structure, built from the discussion on 2026-07-30. Four working sections
plus self-hosting: Learn, Concepts, Guides, Reference.

Every page outside Reference carries a two to three minute video with light supporting
text. The text exists for search and for AI assistants answering questions about Agenta.
Reference is text only.

```
Getting started
  What is Agenta                     video, the launch video
  Quick start                        the shortest path to one working agent

Learn
  Build your first agent             end to end: create it, give it tools, add skills
  Build a marketing coworker         three or four steps, an automation that runs itself

Concepts
  Agents                             what an agent is, and its instructions
  Skills
  Tools and integrations
  Files and knowledge
  Permissions
  Automations
  Harnesses and models
  Sessions and versions
  Cost and usage

Guides
  Write your agent's instructions
  Control what an agent can do
  Manage skills
  Add an MCP server
  Build a knowledge base for your agent
  Create an automation
  Schedule an automation
  Trigger an automation from an app
  Choose a harness and model
  Use your own Claude or ChatGPT subscription
  Analyse cost and usage

Reference
  Agent configuration
  Invoke an agent
  Batch runs
  Chat message format

Self-host
```

## How the sections differ

**Learn** teaches by building something real. It explains each concept at the moment the
reader meets it, lightly, and links to the Concepts page for anyone who wants the full
version. This is the main path, and the one most people will follow.

**Concepts** answers "what is this thing". One page per idea, named after the word a
person would search for. A reader arrives here from Learn, from search, or from an AI
answer.

**Guides** answers a problem the reader already has. Each title is their question, not a
feature name. They assume the reader knows what an agent is.

**Reference** is for developers. Configuration fields, calling an agent from the SDK or
API, batch runs, and the chat message format. Dry, complete, no video.

## Decisions inside the tree

**Agents is one concept page, not four.** It covers what an agent is and how its
instructions work, rather than splitting into separate pages for agents, instructions,
tools, and skills. Skills and tools are their own pages because a reader searches for
those words directly. Instructions stay with agents because they are not a separate thing
you add, they are part of the agent itself. If that page grows past what a single video
can carry, instructions can split out later without moving anything else.

**The quick start stays, separate from the first tutorial.** They serve different people.
Someone evaluating Agenta wants a working agent in five minutes and will not sit through
an end to end build. Someone who has decided to use it wants the full path. If the two
end up saying the same thing, merging them is a one page change.

**Automations has one concept page and three guides.** The concept page explains what an
automation is and that it can start on a schedule or on an event in a connected app. The
guides split by what the reader is trying to do, because setting a schedule and wiring an
app event are different tasks.

**Cost and usage is a concept, not only a reference table.** Readers need to understand
what they are being charged for before a number means anything.

## What is not in the tree yet

- Sub-agents, or using one agent as a tool for another.
- Anything about harnesses beyond the two that ship today.
- Team and access control topics, which live in the existing administration section.

## Order of work

1. The two Learn tutorials, since they define the vocabulary everything else uses and
   they are the pages most people will see.
2. The Concepts pages they link to.
3. Guides.
4. Reference.
