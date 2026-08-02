# Documentation tree: four options

Four ways to shape the Agenta documentation tree, with what each costs and what it buys.
Written against two constraints that change the answer:

- Almost every page carries a two to three minute video. People watch, they do not read.
- The text is there for search and for AI assistants answering questions about the product.

Both constraints push the same way. A page should be one self-contained topic with a name
someone would actually search for, because that is what makes a good video unit and a good
retrieval unit.

## What the comparable products do

**n8n** organises by verb: Get started, Deploy, Build, Nodes, Integrations. Concepts hide
inside Build as "Understand workflows" and "Understand AI components". The reference is
enormous, over five hundred node pages, so the tree exists mostly to keep that reference
navigable.

**Gumloop** organises by noun. Core Concepts is a flat list of roughly thirty-five pages,
each named after one thing: Agents, Agent Skills, Agent Triggers, Agent Artifacts,
Connectors, Credits, Human in the Loop, Run Log. Separate trees for API, CLI, and Nodes.
You look up the noun you heard.

**Stack AI** organises by learning stage. Getting Started contains Start Here, Learning
with a curriculum and challenges, Core AI Concepts, Best Practices, and Tutorials. The
product reference lives in a separate Workflow Builder tree.

**Claude Cowork** is tiny. One overview page fans out to four shared sections: Connectors,
Skills, Plugins, Monitoring. It works because those sections are shared with other Claude
products and carry the weight.

## Option A: Concepts as a flat list

Gumloop's shape. Every concept is a page you can name, link, and film.

```
Getting started
  What is Agenta
  Quick start
Concepts
  Agents
  Instructions (AGENTS.md)
  Tools
  Skills
  Files and folders
  Harnesses and models
  Permissions
  Sessions
  Versions
  Triggers and automations
Guides
  Create an agent by chatting
  Improve your instructions
  Add a tool
  Add an MCP server
  Add a skill
  Write your own skill
  Set permissions
  Build an agent knowledge folder
  Choose harness and model
  Roll back a version
Integrations
Reference
Self-host
```

Buys: one page per noun, which is the best possible shape for search and for an AI
answering "what is a skill in Agenta". Trivial to grow, just add a concept page.

Costs: the concept list has no reading order, so a newcomer does not know where to start.
Learning about skills and adding a skill sit in different sections, so a reader who
finishes the concept page has to go hunting.

## Option B: The user's journey

n8n's shape. Sections are stages of what you are doing.

```
Start
  What is Agenta
  Quick start
Build your agent
  Agents
  Instructions
  Create an agent by chatting
  Improve your instructions
Give it capabilities
  Tools
  Integrations
  MCP servers
  Skills
  Write your own skill
Work with it
  Sessions
  Files and folders
  Permissions and approvals
Run it without you
  Triggers and automations
  Schedules
Improve it
  Versions
  Traces, usage, and cost
Reference
Self-host
```

Buys: mirrors the order a real user lives through, so the sidebar reads like a course. A
natural running order for a video series.

Costs: a topic is filed by the stage it belongs to, not by its name, so someone searching
for "skills" has to guess it is under "Give it capabilities". Several pages genuinely
belong to two stages.

## Option C: Learn, Build, Reference

Stack AI's shape, and the closest to Diataxis without copying it literally.

```
Learn
  What is Agenta
  Quick start
  How agents work
  Instructions, skills, and files
  Harnesses and models
  Examples
Build
  Create an agent by chatting
  Improve your instructions
  Add tools and integrations
  Add and write skills
  Set permissions
  Build a knowledge folder
  Automate with triggers
Reference
  Configuration fields
  Harnesses
  Models and providers
  Permission modes
  File locations
API
Self-host
```

Buys: a clean split between studying and working. The Learn section is an obvious home for
the videos, and a beginner has one door.

Costs: every topic exists twice, once to understand and once to do. Without disciplined
cross-linking the reader bounces between two sections covering the same word.

## Option D: One section per thing in the product

Each section owns one object and holds everything about it: what it is, how to use it, and
its reference, in that order.

```
Getting started
  What is Agenta
  Quick start
Agents
  What is an agent
  Create an agent by chatting
  Instructions (AGENTS.md)
  Improve your instructions
  Versions and history
Skills
  What is a skill
  Add a skill
  Write your own skill
Tools and integrations
  What is a tool
  Add a tool
  Connect an app
  MCP servers
Files and workspaces
  Session files and agent files
  Build a knowledge folder
  Folder instructions
Permissions
  How permissions work
  Set what an agent may do
Automations
  Triggers and schedules
Harnesses and models
  What a harness is
  Choose a harness, model, and credentials
Reference
Self-host
```

Buys: one neighbourhood per topic. Someone who lands on "what is a skill" from a search
finds "add a skill" and "write a skill" in the same section, so the video series and the
sidebar agree. Grows by adding a section when the product adds a thing.

Costs: mixes explanation and instruction inside one section, which strict Diataxis warns
against. The fix is ordering inside the section, concept first and reference last, rather
than splitting the tree.

## Recommendation

Option D.

It matches the two constraints better than the others. Every page is one nameable topic,
which is what a two to three minute video needs and what an AI retrieving an answer needs.
And it puts the concept next to the task, so a reader who watches "what is a skill" can go
straight to "add a skill" without changing sections.

It is also the shape closest to the sketch of "what's an agent, what's a skill". The
sidebar ends up reading like the product's own vocabulary, which is the thing a new user
is trying to learn.

Option A is the runner-up and is a small step away. If Option D's sections start feeling
heavy, flattening the concept pages into one Concepts list turns D into A without moving
any page.

The main risk in D is section sprawl as the product grows. Keeping the top level to
roughly eight or nine sections, and pushing new topics into an existing section before
creating a new one, holds it together.
