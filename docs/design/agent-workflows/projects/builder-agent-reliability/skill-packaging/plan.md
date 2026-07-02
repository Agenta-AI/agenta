# Plan: package and distribute the build-agent skills

This is the chosen design. It reflects the decisions taken on PR #5001. For how the
mechanisms work and why other options were left out, see `research.md`.

## The shape in one paragraph

Ship one public repo, `Agenta-AI/agenta-skills`, that holds several skills as sibling
folders. Distribute it through two point-at-a-repo channels at once: the Claude Code plugin
marketplace and `npx skills` (Vercel). Inside each skill, keep `SKILL.md` small and push
deep detail into a `references/` folder the agent reads only on demand. Agenta writes no
installer code, publishes nothing to npm, and runs no CI.

## 1. The repo: one repo, many sibling skills

The canonical source is a dedicated public repo, `Agenta-AI/agenta-skills`. It holds many
skills as sibling folders under `skills/`. A new topic (such as self-hosting Agenta) is a
sibling skill folder, not a second repository and not a nested "sub-skill".

```
.claude-plugin/
  marketplace.json
skills/
  build-agenta-agent/
    SKILL.md                     # core loop + index of scripts and references
    scripts/
      lib.sh  build.sh  create-agent.sh  test-agent.sh
      discover-tools.sh  discover-triggers.sh  list-connections.sh
      create-schedule.sh  triggers.sh  check-tools.sh
      archive-agent.sh  annotate-trace.sh  check-prereqs.sh
    references/
      writing-instructions.md    # instructions for multi-tool + scheduled agents
      annotate-trace.md          # how to record a reflection against a trace
      config-schema.md           # the agent config, field by field
      tools-and-connections.md   # discovering tools and wiring connections
  self-host-agenta/
    SKILL.md                     # sibling skill: run Agenta yourself
    references/
      docker-compose.md
      configuration.md
README.md
```

`build-agenta-agent` ships first. `self-host-agenta` is drawn to show that new topics land
as siblings in the same repo. Start with the one proven skill; add siblings as content is
ready.

Ship `build-agenta-agent` as a single skill, not four. The in-product build kit split the
same procedure across four cross-referencing skills, and that split is a leading suspect for
why the live agent wandered instead of taking the easy path (see the project `context.md`).
The lab reunified it into one ordered playbook, and that is what made cases cheap.
Progressive disclosure through `references/` gives the room the four-skill split was
reaching for, without the cross-referencing.

## 2. Progressive disclosure inside each skill

Keep `SKILL.md` small and load deeper detail only when a task needs it. The format supports
three loading stages:

1. **Always loaded: the frontmatter.** The `name` and `description` of every installed skill
   stay in the agent's context (about 100 tokens each). The agent reads the `description` to
   decide relevance. Keep it tight, third person, full of trigger words. `name` caps at 64
   characters, `description` at 1024.
2. **Loaded on trigger: the `SKILL.md` body.** The core playbook: the config shape, the
   build loop, the decision table, the hard rules, and an index of the bundled scripts and
   reference files. Keep it under 500 lines.
3. **Loaded on demand: the reference files.** Longer, less-often-needed detail lives under a
   `references/` folder. The agent reads one only when the task calls for it. These files can
   be long because they cost nothing until opened.

`SKILL.md` acts as an index. It holds the core loop inline and points to one reference file
per deep topic with a short "read this when" cue. For `build-agenta-agent`:

| To do this | Read |
| --- | --- |
| Write instructions for a multi-tool or scheduled agent | `references/writing-instructions.md` |
| Annotate a trace / record a reflection | `references/annotate-trace.md` |
| Understand the full agent config schema field by field | `references/config-schema.md` |
| Discover tools and wire a connection | `references/tools-and-connections.md` |

An agent building a one-tool summarizer opens none of these. An agent building a scheduled
multi-tool digest reads `references/writing-instructions.md` at the step where it matters,
and nothing else.

Authoring rules: keep references one level deep (link `SKILL.md` to a reference, do not
chain reference to reference), and mark intent plainly. Say "read `references/x.md`" for
documentation the agent loads, and "run `scripts/x.sh`" for scripts the agent executes
without loading their source. The folder name is a free choice; a skill is a directory and
every file in it is reachable by being linked from `SKILL.md`. We use `references/` to match
this repo's own `gitbutler-workspace-recovery` skill, which already ships a short `SKILL.md`
plus `references/recovery-runbook.md`.

Frontmatter at the top of each `SKILL.md`:

```yaml
---
name: build-agenta-agent
description: >-
  Turn a plain-language request into a working, tested Agenta agent. Use when the user
  wants to build, create, or schedule an Agenta agent through the Agenta API from their
  coding agent. Writes one config and runs a few bundled scripts.
---
```

## 3. Credentials: the skill asks the user, then helps set them

The scripts need two values: `AGENTA_API_KEY` and `AGENTA_HOST` (the host defaults to the
Agenta cloud API, so only self-hosted users set it). `SKILL.md` tells the agent to handle
this as a first step, before any build:

- **Ask the user for the credentials.** The agent asks for the API key, and for the host URL
  only if the user self-hosts.
- **Give the links.** The agent points the user to where to get them: the API key from the
  Agenta project settings page, and the host URL (cloud default, or the user's own domain
  when self-hosting). `SKILL.md` carries these links so the agent does not invent them.
- **Offer to set them up.** The agent offers to either write the values to a local env file
  for the user, or hand the user a paste-ready block to create the file themselves. Either
  way the values land as `AGENTA_API_KEY` and `AGENTA_HOST` in the environment the scripts
  read.

`lib.sh` reads both from the environment. It no longer sources a lab `.env`. This is the one
credential contract the whole kit needs.

## 4. Prerequisites: the skill checks, then asks the user to install

The scripts need `bash`, `curl`, and `jq`. The kit keeps `jq` (it is the right tool for
shell JSON, and swapping it for hand-rolled parsing would make every script longer and more
fragile), but it does not assume `jq` is present, because it often is not (see `research.md`
for the platform breakdown).

Add a `scripts/check-prereqs.sh` preflight that verifies `bash`, `curl`, and `jq` are on
`PATH`. `SKILL.md` tells the agent to run it first and, on a miss, to show the user the exact
install command for their platform (`brew install jq`, `apt-get install jq`, `dnf install
jq`, `apk add jq`) and ask them to install it. A run then fails loud with a clear message
rather than a confusing `jq: command not found` mid-build. The scripts stay on pre-4.0 bash
so they run under macOS's stock bash 3.2.

## 5. Porting the lab scripts

The lab scripts read credentials from a lab `.env` and target the lab's environment. The
port makes two changes: read `AGENTA_API_KEY` / `AGENTA_HOST` from the environment as in
section 3, and point the scripts at the product API endpoints. The finer question of which
invoke path the shipped scripts call is still being worked out and is tracked with the
project; this plan does not settle it. The port targets the product API and no more is
claimed here.

## 6. Two channels, one repo

### Channel A: the Claude Code plugin marketplace

Commit one file, `.claude-plugin/marketplace.json`. Point the plugin entry at the repo root
(`"source": "./"`), set `"strict": false` so the entry is the whole definition, and name the
skill subdirs explicitly. One entry can list every skill in the repo.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "agenta",
  "owner": { "name": "Agenta", "email": "team@agenta.ai" },
  "description": "Skills that teach your coding agent to build Agenta agents via the Agenta API.",
  "plugins": [
    {
      "name": "build-agenta-agent",
      "source": "./",
      "strict": false,
      "skills": ["./skills/build-agenta-agent"],
      "description": "Turn a plain-language request into a working, tested Agenta agent.",
      "version": "0.1.0",
      "author": { "name": "Agenta" },
      "homepage": "https://docs.agenta.ai",
      "license": "MIT",
      "keywords": ["agenta", "agents", "build", "llm"]
    }
  ]
}
```

The marketplace `name` is `agenta` (the reserved names `agent-skills` and
`anthropic-agent-skills` are not allowed). Users install with:

```
/plugin marketplace add Agenta-AI/agenta-skills
/plugin install build-agenta-agent@agenta
```

Pin a semver `version` and bump it per release, so a mid-edit commit does not ship to every
user. When a sibling skill is ready, add another plugin entry.

### Channel B: `npx skills` (Vercel)

`vercel-labs/skills` (npm package `skills`) copies the skill into each harness's native
directory, so each tool discovers it natively with no runtime shim. The repo needs no extra
manifest, only the `SKILL.md` folders under `skills/`.

```bash
npx skills add Agenta-AI/agenta-skills                          # interactive: pick agents + skills
npx skills add Agenta-AI/agenta-skills -a claude-code -a codex -a cursor
npx skills add Agenta-AI/agenta-skills --skill build-agenta-agent --agent '*'
npx skills update                                               # refresh
```

It writes Claude Code's `.claude/skills/`, Codex's and Cursor's `.agents/skills/`, and many
more, each in that harness's real directory. With several sibling skills in the repo,
`npx skills add` lists them all and lets the user pick, or `--skill <name>` selects one. The
`.claude/skills` versus `.agents/skills` difference across harnesses is the installer's
problem, not Agenta's. Agenta keeps one clean `skills/` tree.

### One tree, both channels

Both channels read the same `skills/` tree, so nothing is duplicated. The marketplace entry
references the folder (`"skills": ["./skills/build-agenta-agent"]`) rather than copying the
`SKILL.md`; `npx skills` reads the same folders directly; docs link to the same folders.
One repo holds as many skills as Agenta wants; there is no need for one repo per skill.

## 7. No CI

The point-at-a-repo channels need no publishing pipeline and no CI:

- **Claude marketplace:** no registry, no token, no build step. Committing
  `.claude-plugin/marketplace.json` and the skill folders to a public repo is enough. Users
  clone it on `/plugin marketplace add`; updates are just pushes.
- **`npx skills`:** nothing to publish. The installer reads the GitHub repo directly. There
  is no Agenta-owned npm package and no token; `npx skills` is the user's tool, published by
  Vercel.

The only path that would need an npm org and a publish token is distributing the plugin as
an `npm` source, which we do not use. So no CI is required to ship or maintain these skills.
A repo owner may later add cheap, optional checks (`claude plugin validate .`,
`shellcheck scripts/*.sh`) as a convenience, never as a gate.

## 8. The files and the steps

Files Agenta commits to `Agenta-AI/agenta-skills`:

1. `skills/build-agenta-agent/SKILL.md` (the ported playbook with frontmatter, the core
   loop, and the index of scripts and references).
2. `skills/build-agenta-agent/scripts/*.sh` (the ported scripts plus `check-prereqs.sh`).
3. `skills/build-agenta-agent/references/*.md` (the deep-topic files loaded on demand).
4. `.claude-plugin/marketplace.json` (section 6).
5. `README.md` (the per-harness install one-liners plus the credential setup).

Steps, low-effort first:

1. Create the repo `Agenta-AI/agenta-skills`; use marketplace `name: "agenta"`.
2. Port the kit into `skills/build-agenta-agent/`: env-var credentials, product API target,
   the `check-prereqs.sh` preflight, and the frontmatter. Split the long-tail topics into
   `references/` and leave the core loop in `SKILL.md`.
3. Add `marketplace.json` and a `README.md` with the two install commands.
4. Publish the repo public. Test both channels: `/plugin marketplace add` + `/plugin
   install`, and `npx skills add`.
5. Write one docs page, "Install the Agenta build-agent skills," with the per-harness
   one-liner and the credential setup.
6. Add sibling skills (starting with `self-host-agenta`) as their content is ready, each as
   a new folder under `skills/`.
