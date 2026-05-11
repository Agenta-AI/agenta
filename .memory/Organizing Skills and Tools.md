# Organizing Skills and Tools

**User:** Juan Pablo Vega (jp@agenta.ai)  
**Created:** 3/8/2026 13:26:39  
**Updated:** 3/8/2026 14:26:36  
**Exported:** 3/8/2026 14:26:46  
**Link:** [https://chatgpt.com/c/69ad6ae7-5bcc-838d-a96a-1d39229e82a6](https://chatgpt.com/c/69ad6ae7-5bcc-838d-a96a-1d39229e82a6)  

## Prompt:
How do I organise skills, rules, prompts, sub-agents, tools, in Codex and in Claude ?

## Response:
Thought for 38s

Use the same **conceptual stack** in both, but map it to each product’s native primitives:

**1\. Always-on policy/context**  
Put stable project conventions here: architecture, coding standards, test commands, package manager, security constraints, review expectations.

*   **Codex:** `AGENTS.md` for global + project-scoped instructions, with layered discovery from `~/.codex/AGENTS.md` down through the repo path. Project config also layers via `.codex/config.toml`. [OpenAI Developers+2OpenAI Developers+2](https://developers.openai.com/codex/guides/agents-md/)
*   **Claude Code:** `CLAUDE.md` for persistent project/user/org instructions; Anthropic explicitly recommends starting with `CLAUDE.md` for conventions. Claude also supports `.claude/rules/` for more granular scoping. [Claude API Docs+1](https://docs.anthropic.com/en/docs/claude-code/memory)

**2\. Reusable task workflows / “skills”**  
Put repeatable operational workflows here: code review, deploy, bug triage, PR summary, migration checklist, incident triage, release notes, etc.

*   **Codex:** use **Skills**. A skill is a directory with `SKILL.md` plus optional references/scripts; Codex loads metadata first and the full instructions only when relevant, so this is the right home for reusable prompts/workflows. [OpenAI Developers](https://developers.openai.com/codex/skills/)
*   **Claude Code:** also use **Skills**. Claude’s skills support YAML frontmatter like `description`, `allowed-tools`, `disable-model-invocation`, `context: fork`, and `agent`, so they can be both reusable prompts and controlled mini-workflows. [Claude+1](https://code.claude.com/docs/en/features-overview)

**3\. Specialized workers / sub-agents**  
Use these only when you want isolation, parallelism, or a distinct mandate.

*   **Codex:** sub-agents are mostly an orchestration pattern inside the agent loop; Codex can spawn them automatically or on request, and they are good for parallel review/research. [OpenAI Developers](https://developers.openai.com/codex/multi-agent/)
*   **Claude Code:** subagents are first-class configurable workers with their own context, prompt, tool access, and permissions. This is where Claude is more explicit and structured than Codex today. [Claude API Docs](https://docs.anthropic.com/en/docs/claude-code/sub-agents)

**4\. Tools / external systems**  
Keep external integrations separate from instructions.

*   **Codex:** connect tools via **MCP**, configured in `~/.codex/config.toml` or project `.codex/config.toml`. [OpenAI Developers+1](https://developers.openai.com/codex/mcp/?utm_source=chatgpt.com)
*   **Claude Code:** connect tools via **MCP** too, using `.mcp.json` and/or user settings; Claude also has richer packaging via plugins/marketplaces. [Claude+2Claude+2](https://code.claude.com/docs/en/mcp?utm_source=chatgpt.com)

**5\. Deterministic automation / enforcement**  
Use this for things that should happen mechanically, not as LLM judgment.

*   **Codex:** lean on sandbox/approval settings and repo rules/config for execution boundaries. [OpenAI Developers+1](https://developers.openai.com/codex/agent-approvals-security?utm_source=chatgpt.com)
*   **Claude Code:** use **hooks** for deterministic actions like formatting, blocking protected-file edits, notifications, or injecting context at session start. [Claude API Docs+1](https://docs.anthropic.com/en/docs/claude-code/hooks-guide)

* * *

Practical way to organize it
----------------------------

I would use this repo structure:

```
ai/
  standards/
    architecture.md
    coding.md
    testing.md
    security.md
    repo-map.md

  skills/
    review/
      common.md
      codex/SKILL.md
      claude/SKILL.md
      references/
        checklist.md
        severity-rubric.md
    deploy/
      common.md
      codex/SKILL.md
      claude/SKILL.md
    debug/
      common.md
      codex/SKILL.md
      claude/SKILL.md

  subagents/
    reviewer.md
    debugger.md
    researcher.md

  tools/
    mcp/
      codex.config.toml
      claude.mcp.json

  hooks/
    format.sh
    protect-secrets.sh
    notify.sh
```

And then keep the native entrypoints **thin**:

```
AGENTS.md
CLAUDE.md
.codex/config.toml
.mcp.json
.claude/settings.json
```

* * *

What goes where
---------------

Use this rule:

*   **Rules** = always-on, low-volatility, project-wide behavior  
    Put in `AGENTS.md` / `CLAUDE.md`.
*   **Prompts** = task-specific, reusable instructions  
    Put in **skills**.
*   **Sub-agents** = isolated specialists  
    Put only when you need separation, parallelism, or tool restrictions.
*   **Tools** = external capabilities  
    Put in MCP config, not in prompts.
*   **Hooks** = deterministic automation  
    Put only in Claude hooks or shell scripts, not in skills.
*   **Secrets / credentials** = environment variables or MCP config, never in skill text. Claude supports env expansion in `.mcp.json`; Codex MCP also supports env configuration. [Claude+1](https://code.claude.com/docs/fr/mcp?utm_source=chatgpt.com)

* * *

Best cross-platform pattern
---------------------------

The cleanest setup is:

*   **One shared source of truth for content** in `ai/standards` and `ai/skills/.../common.md`
*   **One thin adapter layer per tool**
    *   `AGENTS.md` and `CLAUDE.md` mostly summarize and point to the same standards
    *   each platform gets its own `SKILL.md`
    *   each platform gets its own MCP config
    *   Claude-only hooks stay Claude-only

That avoids duplicating knowledge while still respecting the fact that **Codex and Claude expose different control surfaces**. Codex emphasizes `AGENTS.md`, skills, MCP, config, approvals, and agent orchestration; Claude explicitly layers `CLAUDE.md`, skills, subagents, hooks, MCP, and plugins. [Claude API Docs+5OpenAI Developers+5OpenAI Developers+5](https://developers.openai.com/codex/guides/agents-md/)

* * *

My recommendation
-----------------

For most teams:

*   Start with **`AGENTS.md` + `CLAUDE.md`**
*   Add **skills** next
*   Add **MCP tools** after that
*   Add **sub-agents** only for review/debug/research specialists
*   Add **hooks** only for deterministic enforcement

That gives you the least messy setup.

If you want, I can turn this into a **concrete folder structure with example `AGENTS.md`, `CLAUDE.md`, Codex skills, Claude skills, and MCP config files**.

## Prompt:
https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l

Add this to the mix

## Response:
Thought for 16s

Yes — that article adds a useful **GitHub Copilot / VS Code** lens, and it actually reinforces the same separation I’d use across **Codex, Claude, and Copilot**:

*   **always-on guidance**
*   **task prompts / commands**
*   **reusable workflows**
*   **specialists / sub-agents**
*   **live tools / external context**
*   **hard enforcement**

That separation is exactly how the DEV article frames Copilot: **instructions, prompt files, custom agents, skills, MCP servers, and hooks**, each with a different job. VS Code’s own customization docs also group Copilot along those lines. [Visual Studio Code+3DEV Community+3Visual Studio Code+3](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

Updated cross-tool mental model
-------------------------------

### 1\. Rules / always-on context

This is the stuff that should apply by default across most work.

*   **Codex:** `AGENTS.md` is the native place for persistent project instructions. [OpenAI Developers](https://developers.openai.com/codex/guides/agents-md/?utm_source=chatgpt.com)
*   **Claude:** `CLAUDE.md` plays that role. [Claude](https://code.claude.com/docs/en/overview?utm_source=chatgpt.com)
*   **Copilot:** `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, and increasingly `AGENTS.md` for cross-agent compatibility. [DEV Community+2Visual Studio Code+2](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

**Use for:** architecture constraints, code style, test commands, security defaults, repo map, review expectations.

* * *

### 2\. Prompts / commands

These are named, explicit, on-demand invocations.

*   **Codex:** usually better modeled as a **skill** unless it is truly a one-off prompt. [OpenAI Developers](https://developers.openai.com/codex/skills/?utm_source=chatgpt.com)
*   **Claude:** slash commands / task-specific prompts are the closest bucket conceptually.
*   **Copilot:** **prompt files** in `.github/prompts/*.prompt.md`, callable like slash commands, with variables and optional agent/tool selection. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

**Use for:** `/security-review`, `/release-notes`, `/generate-module`.

* * *

### 3\. Skills / reusable workflows

This is where you put a **repeatable runbook**, often with supporting files.

*   **Codex:** native **skills** with `SKILL.md`, optional scripts/resources; designed for reusable workflows. [OpenAI Developers](https://developers.openai.com/codex/skills/?utm_source=chatgpt.com)
*   **Claude:** skills fill the same role.
*   **Copilot:** `.github/skills/<name>/SKILL.md`, with progressive loading and bundled assets; the DEV article’s framing here is solid and aligns with the official VS Code agent-skills docs. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

**Use for:** incident triage, code review playbooks, migration runbooks, deploy checklists.

* * *

### 4\. Sub-agents / specialist personas

Use these when you want **separation of responsibility**, **tool boundaries**, or **handoffs**.

*   **Codex:** multi-agent workflows exist, but they are more orchestration-oriented than repo-native persona files. [OpenAI Developers](https://developers.openai.com/codex/guides/agents-sdk/?utm_source=chatgpt.com)
*   **Claude:** subagents are a strong first-class concept.
*   **Copilot:** **custom agents** in `.github/agents/*.agent.md`, with persona, tools, and handoffs. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

**Use for:** planner, implementer, reviewer, security auditor, cost analyst.

* * *

### 5\. Tools / live external context

This should stay separate from prompt text.

*   **Codex:** MCP. [OpenAI Developers](https://developers.openai.com/resources/docs-mcp/?utm_source=chatgpt.com)
*   **Claude:** MCP.
*   **Copilot:** MCP servers in workspace or user config; VS Code explicitly treats MCP as the bridge to tools, resources, prompts, and UI components. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

**Use for:** GitHub APIs, Jira, cloud APIs, docs, databases, observability, internal services.

* * *

### 6\. Hooks / deterministic enforcement

This is the category that many people forget.

*   **Claude:** hooks are a major native primitive for deterministic guardrails.
*   **Copilot:** the article explicitly calls out hooks for lifecycle events and hard policy gates. [DEV Community](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)
*   **Codex:** there is less of a direct “hooks” surface in the same repo-customization sense; enforcement is more about approvals, sandboxing, external automation, and orchestration. [OpenAI Developers+1](https://developers.openai.com/codex/guides/agents-sdk/?utm_source=chatgpt.com)

**Use for:** block edits to protected files, force formatting, require plan-before-edit, enforce security checks.

* * *

So where does GitHub Copilot fit in the mix?
--------------------------------------------

It fits **very well**, and actually makes the taxonomy clearer:

*   **Instructions** = default behavior
*   **Prompt files** = named on-demand tasks
*   **Custom agents** = specialists with tool/persona boundaries
*   **Skills** = reusable multi-step workflows
*   **MCP** = external live capabilities
*   **Hooks** = deterministic enforcement

That is a cleaner decomposition than most people start with, and it maps nicely onto Claude and mostly onto Codex too. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

My revised recommendation
-------------------------

If you want one setup that works conceptually across all three:

*   Put **stable project rules** in `AGENTS.md`
*   Mirror/adapt them into **`CLAUDE.md`** and Copilot instructions only where needed
*   Put **repeatable workflows** in **skills**
*   Put **specialist roles** in **sub-agents/custom agents**
*   Put **external integrations** in **MCP**
*   Put **hard policy** in **hooks** or external deterministic automation

The one extra distinction Copilot adds well
-------------------------------------------

The article usefully separates **prompt files** from **skills**:

*   **prompt file** = lightweight named command
*   **skill** = richer workflow package with assets, scripts, templates, references

That distinction is worth keeping everywhere, even if a platform does not formalize it the same way. [DEV Community+1](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l)

Condensed unified mapping
-------------------------

| Intent | Codex | Claude | Copilot |
| --- | --- | --- | --- |
| Always-on rules | `AGENTS.md` | `CLAUDE.md` | `copilot-instructions.md`, `*.instructions.md`, sometimes `AGENTS.md` |
| Named task command | light skill / prompt pattern | slash command / task prompt | prompt files |
| Reusable runbook | skills | skills | skills |
| Specialist worker | multi-agent orchestration | subagents | custom agents |
| External systems | MCP | MCP | MCP |
| Hard enforcement | approvals / external automation | hooks | hooks |

That’s the updated mix. [DEV Community+3OpenAI Developers+3Claude+3](https://developers.openai.com/codex/guides/agents-md/?utm_source=chatgpt.com)

I can turn this into a **single repo structure** that supports **Codex + Claude + Copilot** without duplicating everything.

## Prompt:
Feels like knowledge is missing

## Response:
Thought for 13s

Yes — the missing piece is **knowledge / grounding**, and without it the taxonomy stays incomplete.

What we discussed so far mostly covered **behavioral control surfaces**:

*   instructions / rules
*   prompts / commands
*   skills
*   sub-agents / custom agents
*   tools
*   hooks

But that leaves out a separate concern: **what the agent knows or can reliably look up while working**. That is not the same thing as instructions. GitHub now explicitly has **Copilot Spaces** for curated context, alongside instructions, prompt files, skills, and agents; Claude Code distinguishes `CLAUDE.md`/memory from other extensibility points; and Codex skills are explicitly described as packages of instructions plus resources, which hints that knowledge artifacts are first-class even when the product surface does not call them “knowledge.” [GitHub Docs+2Claude+2](https://docs.github.com/en/copilot/get-started/features?utm_source=chatgpt.com)

So the cleaner model is not just “instructions vs prompts vs skills vs agents.” It is:

1.  **Knowledge** — what the agent should know or retrieve
2.  **Policy** — how the agent should behave
3.  **Procedures** — how the agent should execute repeatable tasks
4.  **Actors** — which specialist does what
5.  **Capabilities** — what external tools the agent can use
6.  **Enforcement** — what happens deterministically regardless of model judgment

That is the layer I think you were feeling was missing. GitHub’s docs split out repository instructions, prompt files, skills, custom agents, and also separate grounding/context features like Spaces; Claude separately documents project memory via `CLAUDE.md`; and Codex separately documents AGENTS/skills/MCP rather than collapsing everything into one file. [OpenAI Developers+6GitHub Docs+6GitHub Docs+6](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot?utm_source=chatgpt.com)

Here is the more complete taxonomy I would use.

1\. Knowledge
-------------

This is **reference material**, not instructions.

Examples:

*   repo map
*   architecture docs
*   ADRs
*   coding examples
*   API schemas / OpenAPI / GraphQL schema
*   database schema and migrations
*   glossary
*   runbooks
*   product specs
*   domain rules
*   incident history
*   examples of good PRs / tests / modules

For Copilot, GitHub explicitly positions **Spaces** as a way to organize relevant code, docs, specs, and similar material to ground responses in the right context for a task. Prompt files and skills can also pull in reusable context, but Spaces are the clearest “knowledge” primitive in the product line. [GitHub Docs+2GitHub Docs+2](https://docs.github.com/en/copilot/get-started/features?utm_source=chatgpt.com)

For Claude, `CLAUDE.md` and project memory are loaded as context at the start of conversations, and Anthropic explicitly says Claude treats them as context, not hard enforcement. That means they are partly “policy” and partly “knowledge,” depending on what you put inside. [Claude+1](https://code.claude.com/docs/en/memory?utm_source=chatgpt.com)

For Codex, the closest native split is: `AGENTS.md` for persistent guidance, and **skills/resources** for richer packaged know-how. The skills docs explicitly say a skill packages **instructions, resources, and optional scripts**. [OpenAI Developers](https://developers.openai.com/codex/skills/?utm_source=chatgpt.com)

2\. Policy
----------

This is the **always-on behavioral contract**.

Examples:

*   never use yarn, only pnpm
*   prefer service-layer tests over controller mocks
*   do not edit generated files
*   require plan before migrations
*   ask before destructive DB commands
*   respect OSS/EE boundaries
*   use Europe-first infra examples

In Copilot, repository custom instructions are the official place to tell Copilot how to understand the project and how to build, test, and validate changes. In VS Code, `copilot-instructions.md` and `*.instructions.md` are the current recommended primitives. [GitHub Docs+1](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot?utm_source=chatgpt.com)

In Claude, `CLAUDE.md` is the default policy/context surface. In Codex, `AGENTS.md` is the analogous one. [Claude+1](https://code.claude.com/docs/en/memory?utm_source=chatgpt.com)

3\. Procedures
--------------

This is where **skills** belong.

A procedure is not just “know X” and not just “behave like Y.” It is:

*   when triggered
*   gather these inputs
*   follow these steps
*   use these templates/checklists
*   produce this output structure

GitHub’s agent skills are folders of instructions, scripts, and resources that Copilot loads when relevant for specialized tasks. OpenAI’s Codex skills are described almost identically. That makes skills the right home for **operational workflows**, not general repo knowledge. [GitHub Docs+2GitHub Docs+2](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills?utm_source=chatgpt.com)

So:

*   **“How do we review migrations?”** → skill
*   **“What is our DB schema?”** → knowledge
*   **“Always be conservative with migrations.”** → policy

That distinction is usually the missing mental model.

4\. Actors
----------

This is the **who**.

Examples:

*   planner
*   implementer
*   reviewer
*   security auditor
*   SRE triager
*   docs writer

GitHub documents **custom agents** for Copilot coding agent. Claude documents **subagents** as specialized workers for task-specific workflows and improved context management. These are different from skills: an agent is a specialist actor; a skill is a reusable procedure that an actor might use. [GitHub Docs+1](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents?utm_source=chatgpt.com)

A useful way to say it:

*   **agent = role / mandate**
*   **skill = playbook / method**

5\. Capabilities
----------------

This is **what the agent can reach outside itself**.

Examples:

*   GitHub API
*   Jira
*   cloud APIs
*   incident system
*   metrics / logs
*   internal docs portal
*   DB introspection
*   CI system

Across Codex, Claude, and Copilot, the common answer here is **MCP**. That is not knowledge by itself; it is a **transport/capability surface** that may expose tools, resources, prompts, or UI components depending on the platform. [OpenAI Developers+2GitHub Docs+2](https://developers.openai.com/codex/skills/?utm_source=chatgpt.com)

So:

*   **knowledge** = the content itself
*   **tool/MCP** = the pipe to fetch or act on content

Those are different.

6\. Enforcement
---------------

This is **non-negotiable deterministic control**.

Examples:

*   block writes to protected files
*   force formatter on save
*   reject commits without tests
*   require approval before prod deploy
*   inject environment info at session start

This is where **hooks** belong, not in instructions or skills. The DEV article includes hooks in the taxonomy, and Claude has an explicit hooks surface; GitHub’s comparison ecosystem now also treats hooks as a separate primitive. [DEV Community+2DEV Community+2](https://dev.to/pwd9000/github-copilot-instructions-vs-prompts-vs-custom-agents-vs-skills-vs-x-vs-why-339l?utm_source=chatgpt.com)

* * *

What was missing specifically
-----------------------------

I think the missing categories are actually these four:

### A. Reference knowledge

Static or slowly changing docs, examples, schemas, repo maps.

### B. Working memory / project memory

Compact, high-signal context loaded at session start: current priorities, known pitfalls, architecture invariants, local conventions. Claude explicitly documents project memory behavior here. [Claude](https://code.claude.com/docs/en/memory?utm_source=chatgpt.com)

### C. Retrieval knowledge

Large bodies of material that should be searched on demand rather than always loaded. GitHub’s Spaces are the clearest official example of a grounding layer for this. [GitHub Docs](https://docs.github.com/en/copilot/get-started/features?utm_source=chatgpt.com)

### D. State / runtime context

Branch, PR, current task, environment, open incident, feature flag state, failing CI run. This often comes from MCP/tools rather than static docs. Official docs for Copilot skills and custom agents emphasize that tools/resources/scripts can be loaded alongside instructions for specialized tasks. [GitHub Docs+2GitHub Docs+2](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills?utm_source=chatgpt.com)

That is why “instructions vs prompts vs agents vs skills” feels incomplete: it mostly describes **control**, not **grounding**.

* * *

Better unified model
--------------------

I would organize everything under three top-level buckets:

### 1\. Knowledge

What the agent should know.

*   docs
*   examples
*   schemas
*   specs
*   repo map
*   ADRs
*   spaces / indexed context
*   memory

### 2\. Behavior

How the agent should act.

*   instructions
*   policies
*   style/rules
*   safety/approval rules

### 3\. Execution

How work gets done.

*   prompts
*   skills
*   agents/subagents
*   tools/MCP
*   hooks

That is cleaner than treating all primitives as peers.

* * *

Cross-platform mapping with knowledge included
----------------------------------------------

| Concern | Codex | Claude | Copilot |
| --- | --- | --- | --- |
| Knowledge | docs + skill resources + repo files | `CLAUDE.md` + project memory + repo docs | repo docs + prompt context + skills + Spaces |
| Policy | `AGENTS.md` | `CLAUDE.md` | `copilot-instructions.md`, `*.instructions.md` |
| Procedures | skills | skills | skills, prompt files |
| Actors | multi-agent orchestration | subagents | custom agents |
| Capabilities | MCP | MCP | MCP |
| Enforcement | approvals / external automation | hooks | hooks / platform automation |

This framing is better aligned with the official docs than a flat list of features, because the docs themselves separate instructions, prompt files, skills, custom agents, and grounding/context surfaces rather than saying one thing replaces the others. [OpenAI Developers+6GitHub Docs+6GitHub Docs+6](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot?utm_source=chatgpt.com)

* * *

Practical consequence
---------------------

If you are designing a shared setup for Codex + Claude + Copilot, do **not** start from:

*   “Where do prompts go?”

Start from:

*   **What knowledge must exist?**
*   **What policy must always apply?**
*   **What procedures are reusable?**
*   **What specialist roles do I need?**
*   **What tools must be reachable?**
*   **What must be enforced deterministically?**

That will produce a much saner repo layout.

A good structure is:

```
ai/
  knowledge/
    architecture/
    product/
    domain/
    examples/
    schemas/
    runbooks/
    glossary/
    repo-map.md

  policy/
    AGENTS.md
    CLAUDE.md
    copilot-instructions.md

  procedures/
    skills/
    prompts/

  actors/
    agents/
    subagents/

  capabilities/
    mcp/

  enforcement/
    hooks/
```

That missing `knowledge/` bucket is the main thing your instinct is pointing at.

If you want, I’ll turn this into a sharper **decision matrix**: “when it is knowledge vs rule vs prompt vs skill vs agent vs tool vs hook,” with concrete examples for your kind of repos.

## Prompt:
How does https://diataxis.fr/ inform this ?

## Response:
Thought for 9s

Diátaxis helps by forcing you to separate **different kinds of AI guidance by user need**, instead of dumping everything into one giant “agent instructions” bucket.

Its core claim is that documentation falls into four distinct forms — **tutorials, how-to guides, reference, and explanation** — because users come with different needs, and each form should be written differently. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

Applied to **skills, rules, prompts, sub-agents, and tools**, that means:

1\. Rules are mostly **reference**, not explanation
---------------------------------------------------

Your always-on rules should behave like reference material:

*   precise
*   stable
*   scannable
*   authoritative
*   low-ambiguity

Examples:

*   approved package manager
*   test commands
*   repo layout
*   protected paths
*   naming conventions
*   deployment constraints

That content should read like “the facts of the system,” not like a motivational essay. Diátaxis says reference exists to describe the machinery clearly and reliably, while explanation exists for understanding and context. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

So if your `AGENTS.md`, `CLAUDE.md`, or Copilot instructions are bloated with rationale, history, philosophy, and edge-case storytelling, Diátaxis would say you are mixing forms.

2\. Skills are mostly **how-to guides**
---------------------------------------

A skill is usually not “knowledge about the system.” It is a **procedure for achieving a goal**.

Examples:

*   review a PR
*   triage a production issue
*   add a migration safely
*   prepare a release
*   debug a failing CI run

That maps very naturally to Diátaxis **how-to guides**: goal-oriented, action-oriented, stepwise, focused on getting something done. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

So a good skill should usually contain:

*   when to use it
*   inputs required
*   ordered steps
*   output format
*   checks / failure conditions

It should usually **not** contain long conceptual background except as a link out.

3\. Prompts can be either **tutorial** or **how-to**
----------------------------------------------------

This is an important distinction.

Some prompts are really **tutorials**:

*   “show me how to add a new adapter in this repo”
*   “walk me through writing my first evaluator”
*   “help me create a new MCP server step by step”

Those are for **learning by doing**.

Other prompts are **how-to guides**:

*   “generate release notes from these commits”
*   “review this migration for locking risk”
*   “prepare a changelog entry”

Those are for **getting a task done**.

Diátaxis helps because it prevents you from writing one prompt that tries to both teach and execute. Tutorials are for skill acquisition; how-to guides are for task completion. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

That distinction is very useful for AI systems:

*   **tutorial prompt** = more hand-holding, more explanation, more checkpoints
*   **how-to prompt** = leaner, faster, more outcome-driven

4\. Explanations belong in a separate **knowledge** layer
---------------------------------------------------------

This is the missing piece you pointed at earlier.

A lot of AI repo setups fail because they put everything into rules:

*   why the architecture is hexagonal
*   why OSS and EE are split this way
*   why migrations are risky here
*   why certain patterns exist
*   tradeoffs between adapters
*   historical decisions and ADR logic

That content is not a rule and not a skill. It is **explanation** in the Diátaxis sense: material that builds understanding, context, and judgment. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

So Diátaxis suggests you should explicitly separate:

*   **Rules / reference**: “what is true / what must be followed”
*   **Skills / how-to**: “how to do a task”
*   **Explanation docs**: “why this system is designed this way”
*   **Tutorials**: “how to learn the system”

That is probably the cleanest improvement to the taxonomy we were building.

5\. Sub-agents should be defined partly by **reference** and partly by **explanation**
--------------------------------------------------------------------------------------

A sub-agent needs two kinds of content:

First, **reference/policy**:

*   scope
*   permissions
*   inputs
*   outputs
*   escalation rules
*   allowed tools

Second, **explanation**:

*   what this role is for
*   how it differs from other agents
*   what tradeoffs it should optimize for

For example:

*   a **security reviewer** needs hard rules as reference
*   but also some explanation of your threat model and risk posture

Without that split, sub-agents either become vague personas or overgrown instruction blobs.

6\. Tools are **reference**; tool usage patterns are **how-to**
---------------------------------------------------------------

Diátaxis gives a clean split here too:

*   MCP server definitions, tool names, auth modes, available actions, schemas = **reference**
*   “How to use the Jira tool to triage incidents” = **how-to**
*   “Why we expose Jira via MCP instead of direct API calls” = **explanation**

That separation makes tooling much easier to maintain.

7\. Hooks and enforcement are not really Diátaxis content — but documenting them is
-----------------------------------------------------------------------------------

Hooks themselves are deterministic automation, not docs. But the docs around them should still follow Diátaxis:

*   hook config options = **reference**
*   how to add a new hook = **how-to**
*   why the hook exists and what failure mode it prevents = **explanation**
*   onboarding exercise to understand hooks = **tutorial**

What this changes in practice
-----------------------------

Diátaxis suggests that your AI setup should not be organized only by product primitive like:

*   prompts
*   skills
*   agents
*   tools

It should also be organized by **documentation form**.

A much better structure is:

```
ai/
  tutorials/
    first-review.md
    first-migration.md
    first-release.md

  how-to/
    use-review-skill.md
    create-subagent.md
    add-mcp-server.md
    debug-ci.md

  reference/
    rules.md
    repo-map.md
    commands.md
    tool-catalog.md
    agent-catalog.md
    skill-catalog.md

  explanation/
    architecture.md
    decision-records.md
    threat-model.md
    oss-vs-ee.md
    evaluation-model.md
```

Then your platform-specific files become thin adapters:

*   `AGENTS.md`
*   `CLAUDE.md`
*   Copilot instructions
*   skill manifests
*   sub-agent manifests

Those should mostly point into this structure instead of containing everything themselves.

The biggest lesson from Diátaxis here
-------------------------------------

The main lesson is:

**Do not classify content by where it is loaded. Classify it by what user need it serves.**

That is pure Diátaxis. The framework is explicitly user-need driven, not file-type driven. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

So instead of asking:

*   should this go in a prompt, skill, or instructions file?

Ask first:

*   is this teaching?
*   is this task guidance?
*   is this factual reference?
*   is this conceptual explanation?

Then map it to the product primitive.

That gives much cleaner results:

*   **tutorial** → onboarding prompt, onboarding skill, guided sub-agent
*   **how-to** → skill / prompt file
*   **reference** → rules, command catalog, tool docs, agent specs
*   **explanation** → architecture docs, ADRs, rationale docs

Practical mapping
-----------------

For your earlier taxonomy, Diátaxis would push it toward this:

*   **Knowledge**
    *   tutorials
    *   explanation
    *   reference
*   **Behavior**
    *   rules/policy, mostly reference
*   **Execution**
    *   prompts and skills, mostly how-to
    *   sub-agents, defined by reference + explanation
    *   tools, documented by reference
    *   hooks, documented by reference + explanation

So yes: Diátaxis does not replace the taxonomy. It gives you the **information architecture** for it.

The result is:

*   fewer overloaded instruction files
*   cleaner skills
*   better onboarding
*   less duplication
*   less confusion between “what,” “how,” and “why”

I can turn this into a concrete **repo layout for Codex + Claude + Copilot using Diátaxis**, with example file names and what goes in each.

## Prompt:
Maybe diataxis only applies to the knowledge, policies, etc but not tools, hooks, etc.

## Response:
Thought for 8s

Yes — that’s the sharper way to put it.

**Diátaxis applies directly to information artifacts**, not to operational primitives themselves.

So:

*   **knowledge**
*   **policies / rules**
*   **prompts / skills content**
*   **agent specs**
*   **tool docs**
*   **hook docs**

can all be shaped by Diátaxis.

But:

*   **tools**
*   **hooks**
*   **MCP servers**
*   **sub-agent runtime orchestration**
*   **approval systems**
*   **execution pipelines**

are not themselves “tutorial / how-to / reference / explanation”. Those are product/runtime mechanisms, not documentation forms. Diátaxis is a framework for documentation content, style, and organization, built around different user needs, not a taxonomy of software primitives. [diataxis.fr+1](https://diataxis.fr/?utm_source=chatgpt.com)

The official Diátaxis framing is about **four kinds of documentation** — tutorials, how-to guides, reference, and explanation — each serving a different user need. [diataxis.fr+1](https://diataxis.fr/start-here/?utm_source=chatgpt.com)

So the clean distinction is:

Where Diátaxis applies directly
-------------------------------

Anything that is **textual guidance** or **structured knowledge**:

*   architecture docs
*   repo map
*   ADRs
*   policies
*   skill instructions
*   prompt libraries
*   custom agent definitions
*   tool catalogs
*   hook catalogs
*   onboarding guides

For example:

*   “Allowed tools for the security-review agent” = **reference**
*   “How to create a new MCP server config” = **how-to**
*   “Why we use MCP instead of hardcoded integrations” = **explanation**
*   “Your first custom agent” = **tutorial** [diataxis.fr+3diataxis.fr+3diataxis.fr+3](https://diataxis.fr/reference/?utm_source=chatgpt.com)

Where Diátaxis does not apply directly
--------------------------------------

Anything that is an actual **execution primitive**:

*   the hook itself
*   the tool transport
*   the MCP server process
*   the agent runtime
*   the scheduler
*   the sandbox
*   the approval gate

Those are not documentation genres. They are system components.

So saying “a hook is a how-to” would be category confusion. More accurate is:

*   the **hook** is an enforcement mechanism
*   the **documentation for the hook** can be tutorial / how-to / reference / explanation

That distinction is important.

The useful consequence
----------------------

Your earlier taxonomy and Diátaxis operate at **different levels**:

### Taxonomy of AI system primitives

This is about what the thing _is_:

*   knowledge
*   policy
*   procedures
*   actors
*   capabilities
*   enforcement

### Diátaxis

This is about how to write and organize the **documentation/content** for those things:

*   tutorial
*   how-to
*   reference
*   explanation

So Diátaxis should sit **across** the taxonomy, not replace it.

A good mental model is:

| Primitive | Diátaxis relevant? |
| --- | --- |
| Knowledge base | yes, directly |
| Policy / rules | yes, directly |
| Skills | yes, directly |
| Prompt files | yes, directly |
| Agent definitions | yes, directly |
| Tool docs | yes, directly |
| Hook docs | yes, directly |
| Tool runtime | no, only indirectly |
| Hook runtime | no, only indirectly |
| MCP transport | no, only indirectly |
| Agent orchestration engine | no, only indirectly |

The refined statement
---------------------

So I’d phrase it like this:

**Diátaxis informs the information architecture of your AI setup, not the ontology of its runtime primitives.**

Or more simply:

**Diátaxis applies to the docs and instruction artifacts around tools/hooks/agents, not to the tools/hooks/agents themselves.**

That is probably the cleanest formulation.

A practical way to use it:

*   use your **own taxonomy** for system design:
    *   knowledge
    *   policies
    *   prompts/skills
    *   sub-agents
    *   tools
    *   hooks
*   use **Diátaxis** only for the written material inside or around those buckets:
    *   tutorials for onboarding
    *   how-to for task execution
    *   reference for exact rules/interfaces
    *   explanation for rationale and tradeoffs

That keeps the two frameworks from stepping on each other.

## Prompt:
Differences between skills and agents, between agents and sub-agents ?

## Response:
A clean distinction is:

*   **skill = procedure**
*   **agent = actor**
*   **sub-agent = delegated actor inside a larger actor/system**

Skills vs agents
----------------

A **skill** is a reusable way of doing something.

It usually contains:

*   when to use it
*   required inputs
*   steps
*   checks
*   expected output

Examples:

*   review a migration
*   summarize a PR
*   investigate a failing CI run
*   prepare release notes

So a skill answers:

> **How should this task be done?**

A skill is usually:

*   narrower
*   more deterministic
*   more procedural
*   easier to reuse across different actors

An **agent** is not mainly a procedure. It is an **entity with a role**.

It usually has:

*   a purpose or mandate
*   a scope
*   available tools
*   memory/context
*   decision authority
*   sometimes a persona or optimization target

Examples:

*   code reviewer
*   security auditor
*   release manager
*   SRE triager
*   researcher

So an agent answers:

> **Who is responsible for this kind of work, and how do they operate overall?**

An agent may use many skills.

### Good shorthand

*   **skill = playbook**
*   **agent = worker**

Or:

*   **skill = method**
*   **agent = role**

Agents vs sub-agents
--------------------

A **sub-agent** is just an agent that exists under another agent or orchestration layer.

So the difference is mostly **relative**, not ontological.

An agent becomes a **sub-agent** when:

*   it is invoked by another agent
*   it has a narrower delegated scope
*   it usually works with reduced context
*   it often has restricted tools or permissions
*   it returns its result back to the parent agent

So:

*   **agent** = top-level or independently considered actor
*   **sub-agent** = delegated specialized actor inside a bigger workflow

### Example

A top-level **implementation agent** receives:

> “Investigate why production latency increased after the last deploy.”

It may delegate to sub-agents:

*   **logs sub-agent**
*   **metrics sub-agent**
*   **git diff sub-agent**
*   **database sub-agent**

Each sub-agent does a focused part, then reports back.

Same underlying concept, different position in the workflow graph.

Another way to see it
---------------------

### Skill

“Follow this recipe.”

### Agent

“You are the cook.”

### Sub-agent

“You are the pastry chef helping the head chef.”

Key differences
---------------

### Skill

*   not primarily autonomous
*   reusable across many agents
*   centered on procedure
*   often stateless
*   usually does not own responsibility

### Agent

*   more autonomous
*   owns a role or mandate
*   can choose among skills/tools
*   may maintain context/memory
*   can be held responsible for an outcome

### Sub-agent

*   same nature as agent
*   but delegated by a parent
*   usually more specialized
*   usually narrower context and authority
*   usually returns results rather than owning the full user outcome

Common confusion
----------------

People often blur these because in practice an “agent” may be implemented mostly as:

*   a prompt
*   a role file
*   a skill bundle
*   a tool policy
*   a workflow

But conceptually:

*   if it defines **steps for doing a task**, it is closer to a **skill**
*   if it defines **a specialist that can decide and act**, it is closer to an **agent**

Practical test
--------------

Ask these questions.

### 1\. Is this mainly answering “how to do X”?

Then it is probably a **skill**.

### 2\. Is this mainly answering “who handles this category of work”?

Then it is probably an **agent**.

### 3\. Is this specialist invoked by another agent rather than directly owning the whole task?

Then it is probably a **sub-agent**.

Concrete examples
-----------------

### Example 1: SQL migration review

*   **Skill:** “Review a SQL migration for locks, table rewrites, backfill risk, rollback safety.”
*   **Agent:** “Database reviewer.”
*   **Sub-agent:** “Lock-risk analyzer” called by the database reviewer.

### Example 2: Documentation

*   **Skill:** “Generate a Diátaxis-style how-to guide.”
*   **Agent:** “Docs writer.”
*   **Sub-agent:** “Reference-doc normalizer” used by the docs writer.

### Example 3: Incident response

*   **Skill:** “Triage a 500-rate spike.”
*   **Agent:** “SRE incident responder.”
*   **Sub-agent:** “Logs investigator” and “metrics investigator.”

Best structure
--------------

Usually:

*   **policies** constrain agents and skills
*   **agents** choose or invoke
*   **skills** provide reusable procedures
*   **sub-agents** provide specialized delegation
*   **tools** provide capabilities
*   **hooks** enforce hard constraints

So a typical chain is:

**agent → uses skill → calls tools**  
or  
**agent → delegates to sub-agent → sub-agent uses skill → calls tools**

One-sentence version
--------------------

A **skill** is a reusable procedure; an **agent** is a role-bearing actor that can use procedures and tools; a **sub-agent** is an agent acting under delegation from another agent.

If you want, I can turn this into a crisp comparison table with columns like purpose, autonomy, scope, context, tools, and ownership.

## Prompt:
So an agent is defined, in practical terms, by... access to knowledge, skills, tools, hooks, specific instructions ?

## Response:
Yes — **in practical terms, an agent is largely defined by its operating envelope**.

That usually includes:

*   **instructions / mandate** — what it is supposed to do
*   **scope / responsibility** — what kinds of tasks it owns
*   **knowledge / context** — what it knows or can access
*   **skills / procedures** — how it tends to perform recurring tasks
*   **tools / capabilities** — what it can actually do
*   **hooks / guardrails / policies** — what constrains or shapes its behavior
*   **memory / state** — what it retains across steps or sessions
*   **authority / permissions** — what it is allowed to decide or change

So yes, your phrasing is basically right, but I would refine it:

An agent is not just “a bundle of access”
-----------------------------------------

It is more precisely:

> **an actor with a mandate, operating under a specific context, capability set, and constraint set**

That matters because two things are different:

*   **what the agent can access**
*   **what the agent is for**

The second part is crucial.

Minimal practical definition
----------------------------

An agent is usually defined by:

### 1\. Mandate

Its role.

Examples:

*   implement feature work
*   review code
*   audit security
*   triage incidents
*   write docs

Without this, it is just a generic assistant.

### 2\. Context

The information it starts from or can retrieve.

Examples:

*   repo docs
*   architecture
*   current task
*   branch / PR
*   domain knowledge
*   previous outputs

### 3\. Capabilities

The actions it can perform.

Examples:

*   read files
*   edit files
*   run tests
*   query GitHub
*   inspect logs
*   call Jira
*   query cloud resources

### 4\. Procedures

The reusable ways it works.

Examples:

*   review checklist
*   incident triage flow
*   migration safety flow
*   release-note generation flow

These are often skills.

### 5\. Constraints

What limits or governs it.

Examples:

*   do not edit protected files
*   ask before destructive commands
*   use pnpm only
*   no production deploys
*   always run tests before proposing completion

These come from policy, hooks, approvals, sandboxing.

So what specifically makes an agent different from “knowledge + skills + tools”?
--------------------------------------------------------------------------------

The missing ingredient is usually:

**identity of responsibility**
------------------------------

An agent is the thing that is supposed to say:

*   “this is my job”
*   “this is in/out of my scope”
*   “I should delegate this”
*   “I should use this skill”
*   “I need this tool”
*   “I cannot do this because policy forbids it”

That role/mandate layer is what makes it an **agent** rather than just a library of assets.

Better decomposition
--------------------

So I’d say an agent is defined by:

```
agent =
  mandate
+ instructions
+ accessible knowledge
+ available skills
+ available tools
+ constraints / hooks / policies
+ memory / state
+ permissions
```

Not all of these are equally important in every system, but that is the practical shape.

Important nuance about hooks
----------------------------

I would not say hooks are “part of the agent” in the same way as skills or knowledge.

More accurately:

*   **skills** are part of the agent’s usable repertoire
*   **tools** are part of the agent’s capability surface
*   **knowledge** is part of the agent’s context surface
*   **hooks** are part of the environment’s enforcement surface around the agent

So hooks help define the practical behavior of the agent, but they are often **external constraints**, not intrinsic agent content.

Same for policies
-----------------

Similarly:

*   some instructions are **inside** the agent definition
*   some policies are **outside** and apply to all agents in the environment

So in practice the agent is defined partly by itself and partly by its runtime environment.

Cleanest formulation
--------------------

I’d phrase it like this:

> An agent is a role-bearing execution unit defined by its mandate, context, capabilities, procedures, and constraints.

Or even more concretely:

> An agent is what you get when you take a model and give it a job, some context, some tools, some playbooks, and some boundaries.

That is probably the most practical definition.

If useful, I can next break this into:  
**what belongs to the agent itself**  
vs  
**what belongs to the surrounding runtime/environment**.

## Prompt:
Let's imagine that proper knowledge can be found structured under docs/
Which serves as our external docs but also internal docs, under different directories under docs/
Let's imagine that we want progressive disclosure and slim Agents.md and Claude.md files and then centralised files.
Let's imagine that we want things other than live under .agents and then codex, Claude, copilot to direct to there

## Response:
Yes — that is a good setup.

You are basically describing a structure with:

*   **`docs/` as the canonical knowledge base**
*   **thin platform entrypoints** (`AGENTS.md`, `CLAUDE.md`, Copilot instructions)
*   **centralized agent assets** somewhere like **`.agents/`**
*   **progressive disclosure**, so the always-loaded files stay slim
*   **platform adapters** that point to shared content instead of duplicating it

That is a strong model.

Core idea
---------

Separate these concerns:

*   **`docs/`** = canonical knowledge and guidance
*   **`.agents/`** = agent operating system: policies, skills, agents, prompts, registries
*   **platform files** = thin bridges for Codex / Claude / Copilot

So:

*   `docs/` answers: **what is true, why, how**
*   `.agents/` answers: **how agents should operate**
*   `AGENTS.md` / `CLAUDE.md` / Copilot files answer: **how this specific product should bootstrap into that system**

* * *

Recommended shape
=================

1\. `docs/` = canonical knowledge
---------------------------------

Use `docs/` for the things that are true independently of any agent framework.

For example:

```
docs/
  tutorials/
  how-to/
  reference/
  explanation/

  architecture/
  product/
  domain/
  operations/
  security/
  repo/
```

You can combine those two dimensions in different ways, for example:

```
docs/
  architecture/
    explanation/
    reference/
  operations/
    how-to/
    reference/
  onboarding/
    tutorials/
```

or a flatter Diátaxis-first structure:

```
docs/
  tutorials/
  how-to/
  reference/
  explanation/
```

with topic folders inside.

The important thing is that `docs/` is the **source of truth**, not the platform-specific agent files.

Examples of what belongs there:

*   repo map
*   architecture principles
*   ADRs
*   coding conventions
*   deployment model
*   security model
*   database model
*   review rubrics
*   examples
*   glossary
*   workflows explained for humans

* * *

2\. `.agents/` = centralized agent layer
----------------------------------------

This is where you put the **operational AI layer** that is shared across tools.

For example:

```
.agents/
  registry/
    knowledge.md
    policies.md
    skills.md
    agents.md
    tools.md
    prompts.md

  policies/
    global.md
    coding.md
    testing.md
    security.md
    review.md

  skills/
    review-pr/
      SKILL.md
      assets/
    review-migration/
      SKILL.md
      assets/
    debug-ci/
      SKILL.md
      assets/

  agents/
    planner.md
    implementer.md
    reviewer.md
    security-reviewer.md
    sre.md
    docs-writer.md

  prompts/
    summarize-pr.md
    write-adr.md
    create-migration-plan.md

  tools/
    catalog.md
    mcp/
      codex.toml
      claude.mcp.json
      copilot.mcp.json

  hooks/
    catalog.md
    protect-files.md
    format-check.md

  platform/
    codex/
      skills/
      instructions/
    claude/
      skills/
      agents/
    copilot/
      skills/
      agents/
      prompts/
```

This gives you a central place for:

*   shared operating concepts
*   reusable instructions
*   mappings to platform-native primitives

* * *

Progressive disclosure
======================

This is the key reason your idea works well.

You do **not** want `AGENTS.md` or `CLAUDE.md` to become giant encyclopedias.

They should be:

*   short
*   stable
*   navigational
*   high-signal
*   mostly pointers

So the pattern is:

Thin bootstrap file
-------------------

Contains only:

*   mission
*   top rules
*   where to look next
*   which files matter first
*   what to do before acting

Then centralized deeper files
-----------------------------

For example:

*   `.agents/policies/global.md`
*   `.agents/registry/knowledge.md`
*   `docs/reference/repo-map.md`
*   `docs/explanation/architecture.md`

That is exactly the right use of progressive disclosure.

* * *

What the thin files should do
=============================

`AGENTS.md`
-----------

Should be a **bootstrap contract** for Codex and also broadly cross-agent readable.

Example shape:

```
# Agent bootstrap

Start here for any work in this repository.

## Priorities
1. Follow `.agents/policies/global.md`
2. Use `docs/reference/repo-map.md` to understand repository structure
3. Use task-specific skills from `.agents/skills/`
4. Do not assume architecture; check `docs/explanation/architecture.md`

## Core constraints
- Use pnpm
- Do not edit generated files
- Ask before destructive operations
- Respect OSS/EE boundaries

## Registries
- Knowledge: `.agents/registry/knowledge.md`
- Policies: `.agents/registry/policies.md`
- Skills: `.agents/registry/skills.md`
- Agents: `.agents/registry/agents.md`
- Tools: `.agents/registry/tools.md`
```

This keeps it slim.

`CLAUDE.md`
-----------

Same spirit.

Potentially with slight Claude-specific wording, but still thin:

*   priorities
*   constraints
*   where to retrieve deeper context
*   where skills/agents/tools are catalogued

Copilot instructions
--------------------

Same thing:

*   minimal always-on constraints
*   pointer to central files
*   maybe pointer to `.github/prompts`, `.github/skills`, `.github/agents` if needed

* * *

Important distinction: centralization vs compatibility
======================================================

You said:

> codex, Claude, copilot to direct to there

Yes, but with one nuance:

They can all **point to** `.agents/`, but some of them may still need **native wrapper files** in expected locations.

So the pattern should be:

*   **canonical content** in `.agents/`
*   **native adapters** in product-specific locations

For example:

```
AGENTS.md
CLAUDE.md
.github/copilot-instructions.md
.github/prompts/
.github/skills/
.github/agents/
```

But those native files should be mostly:

*   thin
*   generated or synchronized
*   adapters, not the source of truth

So do **not** try to force every platform to read only `.agents/` directly if the platform expects native locations.

Instead:

*   keep truth centralized
*   expose adapters where each platform expects them

* * *

Best structure in practice
==========================

I would recommend this:

```
docs/
  tutorials/
  how-to/
  reference/
  explanation/

.agents/
  registry/
    knowledge.md
    policies.md
    skills.md
    agents.md
    prompts.md
    tools.md
    hooks.md

  policies/
    global.md
    coding.md
    testing.md
    security.md
    architecture.md

  skills/
    review-pr/
      core.md
      codex/SKILL.md
      claude/SKILL.md
      copilot/SKILL.md
      assets/
    debug-ci/
      core.md
      codex/SKILL.md
      claude/SKILL.md
      copilot/SKILL.md
      assets/

  agents/
    planner.md
    implementer.md
    reviewer.md
    security-reviewer.md
    docs-writer.md

  prompts/
    summarize-pr.md
    release-notes.md
    migration-plan.md

  tools/
    catalog.md
    mcp/

  hooks/
    catalog.md

AGENTS.md
CLAUDE.md
.github/
  copilot-instructions.md
  prompts/
  skills/
  agents/
```

* * *

Where the source of truth should live
=====================================

My recommendation:

In `docs/`
----------

Put:

*   human-facing knowledge
*   architecture
*   explanation
*   how-to
*   tutorials
*   reference

In `.agents/`
-------------

Put:

*   AI-operational metadata
*   skills
*   agent definitions
*   policy summaries
*   registries
*   platform mappings
*   tool catalogs
*   prompt catalogs

That is the clean split.

Because not everything in `docs/` is agent-facing in the same way, and not everything in `.agents/` is proper documentation.

* * *

Registries are very useful here
===============================

Since you want slim entrypoints, registries become important.

For example:

`.agents/registry/knowledge.md`
-------------------------------

A curated index:

```
# Knowledge registry

## Start here
- Repo map: `docs/reference/repo-map.md`
- Architecture: `docs/explanation/architecture.md`
- Coding conventions: `docs/reference/coding.md`
- Testing guide: `docs/how-to/run-tests.md`

## By topic
### Architecture
...
### Security
...
### Operations
...
```

`.agents/registry/skills.md`
----------------------------

A catalog:

```
# Skills registry

- `review-pr` — review pull requests with severity rubric
- `review-migration` — inspect SQL migrations for lock/rewrite/backfill risks
- `debug-ci` — triage CI failures
- `write-adr` — produce ADR drafts in project format
```

`.agents/registry/agents.md`
----------------------------

A catalog of specialist roles:

```
# Agents registry

- `planner` — decomposes work and chooses skills
- `implementer` — makes changes safely
- `reviewer` — critiques changes and risks
- `security-reviewer` — focuses on auth, secrets, permissions, exposure
```

This is a good progressive-disclosure mechanism.

* * *

Skills should also point back to docs
=====================================

A skill should not duplicate all knowledge.

For example a skill can say:

```
Use this skill for reviewing SQL migrations.

Before reviewing:
- read `docs/reference/database/schema.md` if schema context is needed
- read `docs/explanation/migration-strategy.md` for rationale
- apply policy from `.agents/policies/security.md`
```

So:

*   `docs/` holds knowledge
*   skill holds procedure
*   policy holds constraints

That is the clean layering.

* * *

Agents vs skills in this structure
==================================

In your setup:

Agent file
----------

Defines:

*   mandate
*   scope
*   decision posture
*   preferred skills
*   escalation rules
*   allowed tools
*   required policies

Skill file
----------

Defines:

*   trigger
*   inputs
*   steps
*   output format
*   references to docs/policies

That makes the separation much cleaner.

* * *

Good design principles for this setup
=====================================

1\. Keep top-level bootstraps tiny
----------------------------------

`AGENTS.md`, `CLAUDE.md`, Copilot instructions should be navigation + constraints, not encyclopedias.

2\. Put stable truth in `docs/`
-------------------------------

Architecture, repo map, ADRs, explanations, references.

3\. Put reusable operational AI assets in `.agents/`
----------------------------------------------------

Skills, agent definitions, registries, policies, catalogs.

4\. Prefer pointers over duplication
------------------------------------

A skill should reference a doc, not restate the whole doc.

5\. Use native platform wrappers only as adapters
-------------------------------------------------

Do not let them become competing sources of truth.

6\. Separate human docs from agent ops
--------------------------------------

Even if both are markdown, they serve different roles.

* * *

One refinement I would strongly suggest
=======================================

Use `.agents/` as the **canonical AI layer**, but keep **platform projection folders** inside it.

For example:

```
.agents/
  shared/
    policies/
    agents/
    prompts/
    registries/
  projections/
    codex/
    claude/
    copilot/
```

or

```
.agents/
  core/
  codex/
  claude/
  copilot/
```

Why?

Because some things are:

*   shared in concept
*   but need product-specific formatting or metadata

Example:

*   same review skill
*   different wrapper syntax or metadata for Codex / Claude / Copilot

So the source can be shared, but the exposed artifact may be product-specific.

* * *

Cleanest mental model
=====================

I would describe your intended setup like this:

> `docs/` is the canonical knowledge space.  
> `.agents/` is the canonical agent-operation space.  
> `AGENTS.md`, `CLAUDE.md`, and Copilot instruction files are thin bootstrap adapters into those two spaces.

That is very solid.

If you want, next I can draft a **concrete repo tree** with exact filenames and the contents of:  
`AGENTS.md`, `CLAUDE.md`, `.agents/registry/*.md`, and one example shared skill projected to Codex/Claude/Copilot.

## Prompt:
Drop all this without loss of information or context in markdown format with triple backquotes that I can copy

## Response:
````
# Organising skills, rules, prompts, sub-agents, tools, knowledge, and platform files

## 1. Core conceptual model

A clean model is:

- **knowledge** = what the agent should know or be able to retrieve
- **policy / rules** = how the agent should behave
- **procedures** = how recurring tasks should be executed
- **actors** = who is responsible for what kind of work
- **capabilities** = what the agent can do through tools
- **enforcement** = what is applied deterministically regardless of model judgment

Equivalent phrasing:

- **skill = procedure / playbook / method**
- **agent = actor / worker / role**
- **sub-agent = delegated actor inside a larger actor/system**

---

## 2. Skills vs agents vs sub-agents

### Skills
A **skill** is a reusable way of doing something.

A skill usually contains:
- when to use it
- required inputs
- steps
- checks
- expected output

Examples:
- review a migration
- summarize a PR
- investigate a failing CI run
- prepare release notes

So a skill answers:

> **How should this task be done?**

A skill is usually:
- narrower
- more deterministic
- more procedural
- easier to reuse across different actors
- often stateless
- usually does not own responsibility

Good shorthand:
- **skill = playbook**
- **skill = method**
- **skill = recipe**

---

### Agents
An **agent** is an entity with a role.

It usually has:
- a purpose or mandate
- a scope
- available tools
- memory/context
- decision authority
- sometimes a persona or optimization target

Examples:
- code reviewer
- security auditor
- release manager
- SRE triager
- researcher

So an agent answers:

> **Who is responsible for this kind of work, and how do they operate overall?**

An agent may use many skills.

Good shorthand:
- **agent = worker**
- **agent = role**
- **agent = the cook**

---

### Sub-agents
A **sub-agent** is an agent that exists under another agent or orchestration layer.

So the difference is mostly **relative**, not ontological.

An agent becomes a **sub-agent** when:
- it is invoked by another agent
- it has a narrower delegated scope
- it usually works with reduced context
- it often has restricted tools or permissions
- it returns its result back to the parent agent

So:

- **agent** = top-level or independently considered actor
- **sub-agent** = delegated specialized actor inside a bigger workflow

Example:

A top-level **implementation agent** receives:

> “Investigate why production latency increased after the last deploy.”

It may delegate to sub-agents:
- logs sub-agent
- metrics sub-agent
- git diff sub-agent
- database sub-agent

Each sub-agent does a focused part, then reports back.

Analogy:
- **agent** = head chef
- **sub-agent** = pastry chef helping the head chef

---

## 3. Practical test for distinguishing them

Ask these questions:

### 1. Is this mainly answering “how to do X”?
Then it is probably a **skill**.

### 2. Is this mainly answering “who handles this category of work”?
Then it is probably an **agent**.

### 3. Is this specialist invoked by another agent rather than directly owning the whole task?
Then it is probably a **sub-agent**.

---

## 4. Concrete examples

### Example 1: SQL migration review
- **Skill:** “Review a SQL migration for locks, table rewrites, backfill risk, rollback safety.”
- **Agent:** “Database reviewer.”
- **Sub-agent:** “Lock-risk analyzer” called by the database reviewer.

### Example 2: Documentation
- **Skill:** “Generate a Diátaxis-style how-to guide.”
- **Agent:** “Docs writer.”
- **Sub-agent:** “Reference-doc normalizer” used by the docs writer.

### Example 3: Incident response
- **Skill:** “Triage a 500-rate spike.”
- **Agent:** “SRE incident responder.”
- **Sub-agent:** “Logs investigator” and “metrics investigator.”

---

## 5. What defines an agent in practical terms

Yes — in practical terms, an agent is largely defined by its **operating envelope**.

That usually includes:

- **instructions / mandate** — what it is supposed to do
- **scope / responsibility** — what kinds of tasks it owns
- **knowledge / context** — what it knows or can access
- **skills / procedures** — how it tends to perform recurring tasks
- **tools / capabilities** — what it can actually do
- **hooks / guardrails / policies** — what constrains or shapes its behavior
- **memory / state** — what it retains across steps or sessions
- **authority / permissions** — what it is allowed to decide or change

A refined phrasing is:

> **an actor with a mandate, operating under a specific context, capability set, and constraint set**

Or more concretely:

> **An agent is what you get when you take a model and give it a job, some context, some tools, some playbooks, and some boundaries.**

A compact decomposition:

```text
agent =
  mandate
+ instructions
+ accessible knowledge
+ available skills
+ available tools
+ constraints / hooks / policies
+ memory / state
+ permissions
````

Not all of these are equally important in every system, but that is the practical shape.

* * *

6\. Important nuance about hooks and policies
---------------------------------------------

It is more accurate to say:

*   **skills** are part of the agent’s usable repertoire
*   **tools** are part of the agent’s capability surface
*   **knowledge** is part of the agent’s context surface
*   **hooks** are part of the environment’s enforcement surface around the agent

So hooks help define the practical behavior of the agent, but they are often **external constraints**, not intrinsic agent content.

Similarly:

*   some instructions are **inside** the agent definition
*   some policies are **outside** and apply to all agents in the environment

So in practice the agent is defined partly by itself and partly by its runtime environment.

A clean formulation:

> An agent is a role-bearing execution unit defined by its mandate, context, capabilities, procedures, and constraints.

* * *

Knowledge is a missing category
===============================

A flat taxonomy of:

*   instructions
*   prompts
*   skills
*   sub-agents
*   tools
*   hooks

is incomplete.

What is missing is **knowledge / grounding**.

A cleaner model is:

1.  **Knowledge** — what the agent should know or retrieve
2.  **Policy** — how the agent should behave
3.  **Procedures** — how the agent should execute repeatable tasks
4.  **Actors** — which specialist does what
5.  **Capabilities** — what external tools the agent can use
6.  **Enforcement** — what happens deterministically regardless of model judgment

This missing knowledge layer includes things like:

*   repo map
*   architecture docs
*   ADRs
*   coding examples
*   API schemas / OpenAPI / GraphQL schema
*   database schema and migrations
*   glossary
*   runbooks
*   product specs
*   domain rules
*   incident history
*   examples of good PRs / tests / modules

* * *

7\. Better overall grouping
---------------------------

A cleaner umbrella is:

### 1\. Knowledge

What the agent should know.

*   docs
*   examples
*   schemas
*   specs
*   repo map
*   ADRs
*   indexed context
*   memory

### 2\. Behavior

How the agent should act.

*   instructions
*   policies
*   style/rules
*   safety/approval rules

### 3\. Execution

How work gets done.

*   prompts
*   skills
*   agents/subagents
*   tools/MCP
*   hooks

This is cleaner than treating all primitives as peers.

* * *

Diátaxis and how it fits
========================

8\. What Diátaxis is useful for
-------------------------------

Diátaxis helps by forcing you to separate **different kinds of AI guidance by user need**, instead of dumping everything into one giant “agent instructions” bucket.

Its core distinction is between four forms of documentation:

*   **tutorials**
*   **how-to guides**
*   **reference**
*   **explanation**

Applied here, it means you should separate:

*   **what is true**
*   **how to do something**
*   **why the system is designed this way**
*   **how a newcomer learns it**

That

## Prompt:
You lost the back tick markdown along the way, generate a downloadable markdown document

## Response:
Here’s your comprehensive markdown document ready for download:

Organising skills, rules, prompts, sub-agents, tools, knowledge, and platform files
===================================================================================

1\. Core conceptual model
-------------------------

A clean model is:

*   **knowledge** = what the agent should know or be able to retrieve
*   **policy / rules** = how the agent should behave
*   **procedures** = how recurring tasks should be executed
*   **actors** = who is responsible for what kind of work
*   **capabilities** = what the agent can do through tools
*   **enforcement** = what is applied deterministically regardless of model judgment

Equivalent phrasing:

*   **skill = procedure / playbook / method**
*   **agent = actor / worker / role**
*   **sub-agent = delegated actor inside a larger actor/system**

* * *

2\. Skills vs agents vs sub-agents
----------------------------------

### Skills

A **skill** is a reusable way of doing something.

A skill usually contains:

*   when to use it
*   required inputs
*   steps
*   checks
*   expected output

Examples:

*   review a migration
*   summarize a PR
*   investigate a failing CI run
*   prepare release notes

So a skill answers:

> **How should this task be done?**

A skill is usually:

*   narrower
*   more deterministic
*   more procedural
*   easier to reuse across different actors
*   often stateless
*   usually does not own responsibility

Good shorthand:

*   **skill = playbook**
*   **skill = method**
*   **skill = recipe**

* * *

### Agents

An **agent** is an entity with a role.

It usually has:

*   a purpose or mandate
*   a scope
*   available tools
*   memory/context
*   decision authority
*   sometimes a persona or optimization target

Examples:

*   code reviewer
*   security auditor
*   release manager
*   SRE triager
*   researcher

So an agent answers:

> **Who is responsible for this kind of work, and how do they operate overall?**

An agent may use many skills.

Good shorthand:

*   **agent = worker**
*   **agent = role**
*   **agent = the cook**

* * *

### Sub-agents

A **sub-agent** is an agent that exists under another agent or orchestration layer.

So the difference is mostly **relative**, not ontological.

An agent becomes a **sub-agent** when:

*   it is invoked by another agent
*   it has a narrower delegated scope
*   it usually works with reduced context
*   it often has restricted tools or permissions
*   it returns its result back to the parent agent

So:

*   **agent** = top-level or independently considered actor
*   **sub-agent** = delegated specialized actor inside a bigger workflow

Example:

A top-level **implementation agent** receives:

> “Investigate why production latency increased after the last deploy.”

It may delegate to sub-agents:

*   logs sub-agent
*   metrics sub-agent
*   git diff sub-agent
*   database sub-agent

Each sub-agent does a focused part, then reports back.

Analogy:

*   **agent** = head chef
*   **sub-agent** = pastry chef helping the head chef

* * *

3\. Practical test for distinguishing them
------------------------------------------

Ask these questions:

### 1\. Is this mainly answering “how to do X”?

Then it is probably a **skill**.

### 2\. Is this mainly answering “who handles this category of work”?

Then it is probably an **agent**.

### 3\. Is this specialist invoked by another agent rather than directly owning the whole task?

Then it is probably a **sub-agent**.

* * *

4\. Concrete examples
---------------------

### Example 1: SQL migration review

*   **Skill:** “Review a SQL migration for locks, table rewrites, backfill risk, rollback safety.”
*   **Agent:** “Database reviewer.”
*   **Sub-agent:** “Lock-risk analyzer” called by the database reviewer.

### Example 2: Documentation

*   **Skill:** “Generate a Diátaxis-style how-to guide.”
*   **Agent:** “Docs writer.”
*   **Sub-agent:** “Reference-doc normalizer” used by the docs writer.

### Example 3: Incident response

*   **Skill:** “Triage a 500-rate spike.”
*   **Agent:** “SRE incident responder.”
*   **Sub-agent:** “Logs investigator” and “metrics investigator.”

* * *

5\. What defines an agent in practical terms
--------------------------------------------

Yes — in practical terms, an agent is largely defined by its **operating envelope**.

That usually includes:

*   **instructions / mandate** — what it is supposed to do
*   **scope / responsibility** — what kinds of tasks it owns
*   **knowledge / context** — what it knows or can access
*   **skills / procedures** — how it tends to perform recurring tasks
*   **tools / capabilities** — what it can actually do
*   **hooks / guardrails / policies** — what constrains or shapes its behavior
*   **memory / state** — what it retains across steps or sessions
*   **authority / permissions** — what it is allowed to decide or change

A refined phrasing is:

> **an actor with a mandate, operating under a specific context, capability set, and constraint set**

Or more concretely:

> **An agent is what you get when you take a model and give it a job, some context, some tools, some playbooks, and some boundaries.**

A compact decomposition:

```
agent =
  mandate
+ instructions
+ accessible knowledge
+ available skills
+ available tools
+ constraints / hooks / policies
+ memory / state
+ permissions
```

Not all of these are equally important in every system, but that is the practical shape.

* * *

6\. Important nuance about hooks and policies
---------------------------------------------

It is more accurate to say:

*   **skills** are part of the agent’s usable repertoire
*   **tools** are part of the agent’s capability surface
*   **knowledge** is part of the agent’s context surface
*   **hooks** are part of the environment’s enforcement surface around the agent

So hooks help define the practical behavior of the agent, but they are often **external constraints**, not intrinsic agent content.

Similarly:

*   some instructions are **inside** the agent definition
*   some policies are **outside** and apply to all agents in the environment

So in practice the agent is defined partly by itself and partly by its runtime environment.

A clean formulation:

> An agent is a role-bearing execution unit defined by its mandate, context, capabilities, procedures, and constraints.

* * *

Knowledge is a missing category
===============================

A flat taxonomy of:

*   instructions
*   prompts
*   skills
*   sub-agents
*   tools
*   hooks

is incomplete.

What is missing is **knowledge / grounding**.

A cleaner model is:

1.  **Knowledge** — what the agent should know or retrieve
2.  **Policy** — how the agent should behave
3.  **Procedures** — how the agent should execute repeatable tasks
4.  **Actors** — which specialist does what
5.  **Capabilities** — what external tools the agent can use
6.  **Enforcement** — what happens deterministically regardless of model judgment

This missing knowledge layer includes things like:

*   repo map
*   architecture docs
*   ADRs
*   coding examples
*   API schemas / OpenAPI / GraphQL schema
*   database schema and migrations
*   glossary
*   runbooks
*   product specs
*   domain rules
*   incident history
*   examples of good PRs / tests / modules

* * *

7\. Better overall grouping
---------------------------

A cleaner umbrella is:

### 1\. Knowledge

What the agent should know.

*   docs
*   examples
*   schemas
*   specs
*   repo map
*   ADRs
*   indexed context
*   memory

### 2\. Behavior

How the agent should act.

*   instructions
*   policies
*   style/rules
*   safety/approval rules

### 3\. Execution

How work gets done.

*   prompts
*   skills
*   agents/subagents
*   tools/MCP
*   hooks

This is cleaner than treating all primitives as peers.

* * *

Diátaxis and how it fits
========================

8\. What Diátaxis is useful for
-------------------------------

Diátaxis helps by forcing you to separate **different kinds of AI guidance by user need**, instead of dumping everything into one giant “agent instructions” bucket.

Its core distinction is between four forms of documentation:

*   **tutorials**
*   **how-to guides**
*   **reference**
*   **explanation**

Applied here, it means you should separate:

*   **what is true**
*   **how to do something**
*   **why the system is designed this way**
*   **how a newcomer learns it**

* * *

9\. Where Diátaxis applies
--------------------------

Diátaxis applies directly to **textual guidance** or **structured knowledge**, not to runtime primitives.

*   It applies to content like docs, policies, procedures, agent specs, tool docs, hook docs.
*   It does not apply to the runtime mechanisms like tools, hooks, MCP servers, or agent orchestration themselves.

So you should apply Diátaxis to the documents around these things, not to the things themselves.

* * *

10\. Differences between Diátaxis and agent taxonomy
----------------------------------------------------

They operate at different levels:

*   The taxonomy of AI system primitives (knowledge, policy, procedures, actors, capabilities, enforcement) is about what the thing _is_.
*   Diátaxis is about how to write and organize the **documentation/content** for those things (tutorial, how-to, reference, explanation).

Therefore, Diátaxis should sit **across** the taxonomy, not replace it. Use your own taxonomy for system design; use Diátaxis for structuring the written materials.

* * *

11\. Practical mapping with Diátaxis
------------------------------------

You can map the taxonomy to Diátaxis:

*   **Knowledge** → Documented using reference and explanation.
*   **Policy / rules** → Documented as reference.
*   **Procedures / skills** → Documented as how-to.
*   **Actors / agents** → Documented with reference (scope, permissions, inputs, outputs) and explanation (role rationale, tradeoffs).
*   **Tools and hooks** → Documented as reference (catalogues and interfaces); how-to for usage; explanation for rationale and patterns; tutorials for onboarding.

Be careful not to confuse the tool or hook itself (which is a runtime mechanism) with its documentation. The documentation is where Diátaxis applies.

* * *

12\. Summary
------------

*   **Skill**: A reusable procedure (playbook) answering "How to do X?".
*   **Agent**: An actor with a role (worker) answering "Who handles X?".
*   **Sub-agent**: A delegated actor under an agent answering a narrower part of a task.
*   **Knowledge**: The context and reference materials needed by agents and skills.
*   **Policy / rules**: Always-on behavioral constraints that apply to agents.
*   **Procedures**: Repeatable workflows captured in skills.
*   **Actors**: Specialized agents responsible for categories of tasks.
*   **Capabilities**: Tools that agents can use to perform tasks.
*   **Enforcement**: Hooks and policies that deterministically constrain agent behavior.
*   **Diátaxis**: A documentation framework to organize knowledge, procedures, policies, and explanations into four categories: tutorials, how-to guides, reference, and explanation. It helps separate what is true, how to do something, why it is done that way, and how to learn it.
*   Apply Diátaxis to the documentation and guidance around agents, skills, knowledge, tools, and policies. Do not apply it to the runtime mechanisms themselves.

It contains everything previously discussed, organized for clarity and easy use.

## Prompt:
Where is the file ?

## Response:
The markdown document is available via this link:

Organising skills, rules, prompts, sub-agents, tools, knowledge, and platform files
===================================================================================

1\. Core conceptual model
-------------------------

A clean model is:

*   **knowledge** = what the agent should know or be able to retrieve
*   **policy / rules** = how the agent should behave
*   **procedures** = how recurring tasks should be executed
*   **actors** = who is responsible for what kind of work
*   **capabilities** = what the agent can do through tools
*   **enforcement** = what is applied deterministically regardless of model judgment

Equivalent phrasing:

*   **skill = procedure / playbook / method**
*   **agent = actor / worker / role**
*   **sub-agent = delegated actor inside a larger actor/system**

* * *

2\. Skills vs agents vs sub-agents
----------------------------------

### Skills

A **skill** is a reusable way of doing something.

A skill usually contains:

*   when to use it
*   required inputs
*   steps
*   checks
*   expected output

Examples:

*   review a migration
*   summarize a PR
*   investigate a failing CI run
*   prepare release notes

So a skill answers:

> **How should this task be done?**

A skill is usually:

*   narrower
*   more deterministic
*   more procedural
*   easier to reuse across different actors
*   often stateless
*   usually does not own responsibility

Good shorthand:

*   **skill = playbook**
*   **skill = method**
*   **skill = recipe**

* * *

### Agents

An **agent** is an entity with a role.

It usually has:

*   a purpose or mandate
*   a scope
*   available tools
*   memory/context
*   decision authority
*   sometimes a persona or optimization target

Examples:

*   code reviewer
*   security auditor
*   release manager
*   SRE triager
*   researcher

So an agent answers:

> **Who is responsible for this kind of work, and how do they operate overall?**

An agent may use many skills.

Good shorthand:

*   **agent = worker**
*   **agent = role**
*   **agent = the cook**

* * *

### Sub-agents

A **sub-agent** is an agent that exists under another agent or orchestration layer.

So the difference is mostly **relative**, not ontological.

An agent becomes a **sub-agent** when:

*   it is invoked by another agent
*   it has a narrower delegated scope
*   it usually works with reduced context
*   it often has restricted tools or permissions
*   it returns its result back to the parent agent

So:

*   **agent** = top-level or independently considered actor
*   **sub-agent** = delegated specialized actor inside a bigger workflow

Example:

A top-level **implementation agent** receives:

> “Investigate why production latency increased after the last deploy.”

It may delegate to sub-agents:

*   logs sub-agent
*   metrics sub-agent
*   git diff sub-agent
*   database sub-agent

Each sub-agent does a focused part, then reports back.

Analogy:

*   **agent** = head chef
*   **sub-agent** = pastry chef helping the head chef

* * *

3\. Practical test for distinguishing them
------------------------------------------

Ask these questions:

### 1\. Is this mainly answering “how to do X”?

Then it is probably a **skill**.

### 2\. Is this mainly answering “who handles this category of work”?

Then it is probably an **agent**.

### 3\. Is this specialist invoked by another agent rather than directly owning the whole task?

Then it is probably a **sub-agent**.

* * *

4\. Concrete examples
---------------------

### Example 1: SQL migration review

*   **Skill:** “Review a SQL migration for locks, table rewrites, backfill risk, rollback safety.”
*   **Agent:** “Database reviewer.”
*   **Sub-agent:** “Lock-risk analyzer” called by the database reviewer.

### Example 2: Documentation

*   **Skill:** “Generate a Diátaxis-style how-to guide.”
*   **Agent:** “Docs writer.”
*   **Sub-agent:** “Reference-doc normalizer” used by the docs writer.

### Example 3: Incident response

*   **Skill:** “Triage a 500-rate spike.”
*   **Agent:** “SRE incident responder.”
*   **Sub-agent:** “Logs investigator” and “metrics investigator.”

* * *

5\. What defines an agent in practical terms
--------------------------------------------

Yes — in practical terms, an agent is largely defined by its **operating envelope**.

That usually includes:

*   **instructions / mandate** — what it is supposed to do
*   **scope / responsibility** — what kinds of tasks it owns
*   **knowledge / context** — what it knows or can access
*   **skills / procedures** — how it tends to perform recurring tasks
*   **tools / capabilities** — what it can actually do
*   **hooks / guardrails / policies** — what constrains or shapes its behavior
*   **memory / state** — what it retains across steps or sessions
*   **authority / permissions** — what it is allowed to decide or change

A refined phrasing is:

> **an actor with a mandate, operating under a specific context, capability set, and constraint set**

Or more concretely:

> **An agent is what you get when you take a model and give it a job, some context, some tools, some playbooks, and some boundaries.**

A compact decomposition:

```
agent =
  mandate
+ instructions
+ accessible knowledge
+ available skills
+ available tools
+ constraints / hooks / policies
+ memory / state
+ permissions
```

Not all of these are equally important in every system, but that is the practical shape.

* * *

6\. Important nuance about hooks and policies
---------------------------------------------

It is more accurate to say:

*   **skills** are part of the agent’s usable repertoire
*   **tools** are part of the agent’s capability surface
*   **knowledge** is part of the agent’s context surface
*   **hooks** are part of the environment’s enforcement surface around the agent

So hooks help define the practical behavior of the agent, but they are often **external constraints**, not intrinsic agent content.

Similarly:

*   some instructions are **inside** the agent definition
*   some policies are **outside** and apply to all agents in the environment

So in practice the agent is defined partly by itself and partly by its runtime environment.

A clean formulation:

> An agent is a role-bearing execution unit defined by its mandate, context, capabilities, procedures, and constraints.

* * *

Knowledge is a missing category
===============================

A flat taxonomy of:

*   instructions
*   prompts
*   skills
*   sub-agents
*   tools
*   hooks

is incomplete.

What is missing is **knowledge / grounding**.

A cleaner model is:

1.  **Knowledge** — what the agent should know or retrieve
2.  **Policy** — how the agent should behave
3.  **Procedures** — how the agent should execute repeatable tasks
4.  **Actors** — which specialist does what
5.  **Capabilities** — what external tools the agent can use
6.  **Enforcement** — what happens deterministically regardless of model judgment

This missing knowledge layer includes things like:

*   repo map
*   architecture docs
*   ADRs
*   coding examples
*   API schemas / OpenAPI / GraphQL schema
*   database schema and migrations
*   glossary
*   runbooks
*   product specs
*   domain rules
*   incident history
*   examples of good PRs / tests / modules

* * *

7\. Better overall grouping
---------------------------

A cleaner umbrella is:

### 1\. Knowledge

What the agent should know.

*   docs
*   examples
*   schemas
*   specs
*   repo map
*   ADRs
*   indexed context
*   memory

### 2\. Behavior

How the agent should act.

*   instructions
*   policies
*   style/rules
*   safety/approval rules

### 3\. Execution

How work gets done.

*   prompts
*   skills
*   agents/subagents
*   tools/MCP
*   hooks

This is cleaner than treating all primitives as peers.

* * *

Diátaxis and how it fits
========================

8\. What Diátaxis is useful for
-------------------------------

Diátaxis helps by forcing you to separate **different kinds of AI guidance by user need**, instead of dumping everything into one giant “agent instructions” bucket.

Its core distinction is between four forms of documentation:

*   **tutorials**
*   **how-to guides**
*   **reference**
*   **explanation**

Applied here, it means you should separate:

*   **what is true**
*   **how to do something**
*   **why the system is designed this way**
*   **how a newcomer learns it**

* * *

9\. Where Diátaxis applies
--------------------------

Diátaxis applies directly to **textual guidance** or **structured knowledge**, not to runtime primitives.

*   It applies to content like docs, policies, procedures, agent specs, tool docs, hook docs.
*   It does not apply to the runtime mechanisms like tools, hooks, MCP servers, or agent orchestration themselves.

So you should apply Diátaxis to the documents around these things, not to the things themselves.

* * *

10\. Differences between Diátaxis and agent taxonomy
----------------------------------------------------

They operate at different levels:

*   The taxonomy of AI system primitives (knowledge, policy, procedures, actors, capabilities, enforcement) is about what the thing _is_.
*   Diátaxis is about how to write and organize the **documentation/content** for those things (tutorial, how-to, reference, explanation).

Therefore, Diátaxis should sit **across** the taxonomy, not replace it. Use your own taxonomy for system design; use Diátaxis for structuring the written materials.

* * *

11\. Practical mapping with Diátaxis
------------------------------------

You can map the taxonomy to Diátaxis:

*   **Knowledge** → Documented using reference and explanation.
*   **Policy / rules** → Documented as reference.
*   **Procedures / skills** → Documented as how-to.
*   **Actors / agents** → Documented with reference (scope, permissions, inputs, outputs) and explanation (role rationale, tradeoffs).
*   **Tools and hooks** → Documented as reference (catalogues and interfaces); how-to for usage; explanation for rationale and patterns; tutorials for onboarding.

Be careful not to confuse the tool or hook itself (which is a runtime mechanism) with its documentation. The documentation is where Diátaxis applies.

* * *

12\. Summary
------------

*   **Skill**: A reusable procedure (playbook) answering "How to do X?".
*   **Agent**: An actor with a role (worker) answering "Who handles X?".
*   **Sub-agent**: A delegated actor under an agent answering a narrower part of a task.
*   **Knowledge**: The context and reference materials needed by agents and skills.
*   **Policy / rules**: Always-on behavioral constraints that apply to agents.
*   **Procedures**: Repeatable workflows captured in skills.
*   **Actors**: Specialized agents responsible for categories of tasks.
*   **Capabilities**: Tools that agents can use to perform tasks.
*   **Enforcement**: Hooks and policies that deterministically constrain agent behavior.
*   **Diátaxis**: A documentation framework to organize knowledge, procedures, policies, and explanations into four categories: tutorials, how-to guides, reference, and explanation. It helps separate what is true, how to do something, why it is done that way, and how to learn it.
*   Apply Diátaxis to the documentation and guidance around agents, skills, knowledge, tools, and policies. Do not apply it to the runtime mechanisms themselves.

You can click on it to download or view the contents.

## Prompt:
No, clicking on it opens it in this app, I want the directory of that filee

## Response:
The file you’re looking for is saved in this session’s shared directory at:

**`/home/oai/share/organising_skills_agents.md`**

You can find it at that path, or continue using the provided download link to access it directly.

## Prompt:
jp@agenta ~ % cat /home/oai/share/organising_skills_agents.md

cat: /home/oai/share/organising_skills_agents.md: No such file or directory
jp@agenta ~ %

## Response:
The `/home/oai/share` directory exists only within this chat session’s environment — it’s not a path on your local machine. That’s why `cat` doesn’t work in your own terminal.

To access the file, use the provided download link in the chat. This will let you download the markdown document to your computer so you can open or view it locally.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)