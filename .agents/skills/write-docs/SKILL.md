---
name: write-docs
description: Use when writing or editing documentation pages (concept pages, how-to guides, API reference prose, tutorials) under docs/. Provides the writing style, voice, and structural rules for Agenta docs. Apply this skill before drafting any new docs page, and include it in the brief for any subagent tasked with writing docs.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Write Docs

A short, living set of rules for writing documentation in this repo. Update as we learn what works.

## 0. Write for a reader in a situation

This rule governs every other rule below. Every failure in a doc review traces back to breaking it.

Your reader is a **stranger with a job to do**. They are not your teammate, they did not read the PR, they do not know the codebase, and they do not care about your reasoning. They arrived with a situation and a question. Serve that, nothing else.

Some readers are agents, some are humans. Write for both: an agent needs unambiguous structure, a human needs to find their case fast. Neither needs your narration.

### The four beats

For anything non-trivial (a troubleshooting entry, a decision, a procedure with branches), give the reader these in order. Do not overdo it on simple content.

1. **Context.** What is the situation? Stated plainly, so I can tell whether I am in it.
2. **Relevance.** Is this me? Do I need to act? Let me self-select out fast.
3. **Instructions.** Exactly what to run or change. Concrete, copy-pasteable.
4. **References.** Links to go deeper, if it is complicated.

A section that says "enable the tunnel profile" without telling me *how* has skipped beat 3. A warning that does not tell me whether it applies to me has skipped beats 1 and 2.

### Never assume things about the reader

Do not tell readers what they think, what they usually get wrong, or what their first question is. You do not know them, and the sentence serves you, not them.

- BAD: "This is the part teams usually get wrong."
- BAD: "This is the first question a self-hosting community asks."
- BAD: "You probably want X."
- GOOD: State the fact. Let them decide if it is their case.

### No opinions, no value judgments

Docs state facts and give instructions. They do not give advice you were not asked for, and they do not editorialize.

- BAD: "Keep CPU and memory generous."
- BAD: "This is the right way to do it."
- GOOD: "The default is 2 CPU / 4 GB. To change it, set X."

If a constraint is real, state it as a constraint ("the idle TTL must be below AUTOSTOP, or Daytona stops a sandbox the runner still holds"). That is a fact, not an opinion.

### Only the reader's problem belongs on the page

Cut anything that is not the reader's concern in *their* situation.

- In a how-to for running agents on Daytona, the **code evaluator's** sandbox is not the reader's problem. It confuses them. If the fact matters, it belongs in reference.
- Do not pre-empt failure modes the reader cannot hit. If you just told them to run the snapshot recipe, do not then warn "if the image is missing Pi…". They followed your instructions. It will not be missing.

Ask of every sentence: **in the situation this page is for, does the reader need this?** If not, delete it or move it to reference.

### Parallel things get parallel structure

If two options exist (Daytona and local; Compose and Helm), give them **mirrored sections with the same sub-structure, in the same order, on every page**. A reader learns the shape once and then navigates by it.

- Nest correctly. "What crosses into the Daytona sandbox" belongs **under** Daytona, not floating at the top level.
- If you write a subsection for one option, write the matching one for the other, or explicitly say it does not apply.
- Lead with the option you want most people to use.

### An instruction without a concrete example is not an instruction

"Add your dependencies" tells the reader nothing. Name a plausible thing and show the line. The
reader adapts an example far faster than they invent one from a description.

- BAD: "Add your dependencies to the recipe."
- GOOD: "Add your dependencies to `dockerfile_commands`. For example, the `gh` CLI and Chromium: `RUN apt-get install -y gh chromium`."
- GOOD: "Mount a repository checkout so agents can work on it: `- /srv/repos/my-service:/agenta/workspaces/my-service:rw`. Use `:ro` when they should only read it."

### Use the precise word, not the dramatic one

Vague adjectives, especially security ones, make the reader guess. Say the condition that is
actually true.

- BAD: "Use Daytona when your deployment is exposed." (Exposed to what? Does that include me?)
- GOOD: "Use Daytona when more than one person can start runs on the deployment."
- BAD: "Local runs are not safe."
- GOOD: "Local runs are not isolated from each other. One user's agent can read another's files."

### A pointer is a sentence, not a section

If the answer is "go read that other page", write one sentence with the link where the reader hits
the question. Do not give it a heading and three paragraphs of setup. A section promises content.

### Slugs exist to preserve URLs

Add a `slug:` to a page's frontmatter only when the file moved and the old public URL must keep
working, or when the natural path is wrong. Never add one just because other pages have one.

### Verify every instruction against the thing it instructs

Prose discipline is not enough. An instruction you did not check is a lie with good grammar, and it
costs the reader an afternoon.

Before you write "set X in your values file", open the chart and confirm the key exists. Before you
write "add a `COPY` step", confirm the build has a local context. Before you name an env var,
confirm the code reads it. Before you claim "everything else is documented above", go count.

Real failures caught in review, all of which read fluently:

- BAD: "For Helm, add the volume to the runner pod in your values file." The chart renders **no**
  user volumes and `values.schema.json` has no volumes key. The instruction is impossible.
- BAD: "Copy files in with a `COPY` step." The snapshot recipe uses `dockerfile_commands()` with no
  local build context, so `COPY` cannot work. `RUN git clone` can.
- BAD: "Every other variable the runner reads is documented above." It reads about forty more.

If you cannot verify a claim, do not write it. Cut it, or go read the code.

### Prerequisites are the universal minimum; edge cases go in troubleshooting

A prerequisites list is what EVERY reader needs before they start. Do not pad it with the obvious,
and do not front-load setup that only a subset hits. If a problem bites only some readers, put it in
troubleshooting keyed to the symptom they will actually see, so the rest never read it.

- BAD (prerequisite): "Docker installed on your machine." Obvious. Cut it, or make it one line.
- BAD (prerequisite): three paragraphs on `/var/run/docker.sock` ownership and `usermod -aG docker`
  before the reader can run anything. Most readers already have daemon access.
- GOOD (troubleshooting): "**`permission denied ... /var/run/docker.sock`** — your user cannot reach
  the Docker daemon. Run as root, use `sudo`, or `sudo usermod -aG docker $USER` then open a new
  shell. (docker-group membership is root-equivalent on the host.)"

### Reuse the patterns that already exist

Before inventing a layout, look at how the rest of the docs do it. Use the existing Docusaurus components: `:::info`, `:::warning`, `:::tip`, collapsibles. Do not invent a new troubleshooting format per page. Consistency is what lets a reader skim.

Use an admonition for a genuine warning or aside. Do not smuggle a caveat into body prose.

### Titles are plain labels, not sentences

A heading is a signpost. "Sandbox isolation and security", not a clause or a claim. If a reader cannot tell what is under a heading from the heading alone, rename it.

### Overview pages are indexes, not essays

An overview answers "where do I start and what applies to me". It is a short, high-level map with links, not a prose introduction to the product and not a restatement of the sidebar. Assume the reader already knows what Agenta is.

### Comments in config examples are for humans

Env examples get commented for a human skimming them, not for exhaustive machine documentation.

- Comment the **non-obvious**: defaults, units, constraints, what breaks.
- Do **not** comment the obvious. `AGENTA_RUNNER_CONCURRENCY_LIMIT` does not need "maximum concurrent runs".
- Long explanations belong in the reference page, not in every env file.

## 1. Pick the doc type first (Diátaxis)

Before writing, decide which of the four types you are writing. Don't mix them in one page.

| Type | Purpose | Reader is… | Example |
|---|---|---|---|
| **Tutorial** | Teach a skill through a guided run | Learning | "Build your first Agenta application" |
| **How-to** | Accomplish a specific task | Working, already competent | "How to deploy a variant to production" |
| **Reference** | Look up facts during work | Working | API endpoint pages, config option lists |
| **Explanation** | Understand the why | Studying | "How versioning works in Agenta" |

Quick test: **Is the reader learning or working? Do they need procedures, facts, or context?** If you can't answer, pick the type before drafting.

Don't pollute a page with another type. Link out instead. A how-to that explains background mid-flow breaks the reader's task.

## 2. Style

**Tone:** Docker / Stripe reference tone. Declarative. Helpful, not promotional.

**Voice:**
- Active voice.
- Short, punchy sentences by default.
- Complete sentences unless brevity clearly wins.
- 11th-grade English for non-technical wording.
- Conditional imperatives in how-tos: "If you want X, do Y."

**Words to avoid:** "comprehensive", "powerful", "seamlessly", "easily", "simply", "robust", "leverage". Marketing words.

**Punctuation:**
- **Never use em dashes (—).** Use a period, parentheses, or a semicolon.
- Bold and bullets sparingly; only when they aid scanning.

**Length:**
- Short paragraphs.
- Cut anything that doesn't serve the reader's goal on this page.
- Reference pages are dry on purpose. Don't add narrative.

## 3. Customer-facing vocabulary

Docs use the words customers see in the UI and API. Internal vocabulary stays in source code.

| Don't write | Write |
|---|---|
| runnable | application / workflow / evaluator (whichever applies) |
| loadable | testset revision |
| artifact / variant / revision (without context) | Use the words, but link the first occurrence to the versioning concept page |

If a page introduces a term, link to its concept page on first use.

## 4. Examples must be obfuscated but accurate

- Use placeholder UUIDs: `019d952f-0000-0000-0000-000000000000`.
- Use fake but plausible data: `"country": "France"`.
- **Verify request/response shapes against the live API** (`eu.cloud.agenta.ai` with the saved key) before publishing. Shapes must match what the endpoint actually returns.
- If you find a bug while verifying, file it. Do not paper over it in the docs.

## 5. How-to specific rules

When writing a how-to:
- Title is the user's goal, not the feature name. "How to invoke a deployed variant" beats "Using the invoke endpoint".
- Only actions on the page. No teaching, no rationale digressions. Link out for those.
- Branch where reality branches. "If your app uses chat, do X. Otherwise do Y."
- Start at a meaningful entry point. Don't repeat setup from a prerequisite page; link to it.
- Anticipate the next step. Each step should set up the next.

## 6. Reference specific rules

- Tables, lists, parameter descriptions. No narrative.
- Every parameter gets a description, type, and whether it's required.
- For FastAPI: docstrings go on the handler function. Field descriptions go on `Field(description=...)`. Never put prose in `openapi_extra={}`.
- Don't explain "why" in reference. Link to an explanation page if needed.

## 7. Concept (explanation) specific rules

- Lead with the model the reader needs to hold in their head.
- One worked example is worth three abstract paragraphs.
- It's OK to be discursive here. This is the one type where narrative belongs.
- End by pointing to the how-tos and reference pages that apply the concept.

## 8. Auto-generated content: stay out of `docs/docs/reference/api/`

The `*.api.mdx` files under `docs/docs/reference/api/` are auto-generated by `docusaurus-plugin-openapi-docs` from `docs/docs/reference/openapi.json`. **Do not commit changes to those files from a domain PR.** They produce 100+ files of noise per regen, and the regen is mechanical.

The auto-generated MDX is regenerated separately, downstream, after the underlying spec is updated. Two important facts about that flow:

- `pnpm update-api-docs` (the default) downloads `openapi.json` **from production** (`raw.githubusercontent.com/.../main`). That spec does **not** yet contain your branch's new docstrings, so regenerating from it strips your work back out.
- To get the new docstrings into the rendered docs, `openapi.json` has to be dumped from the **branch's** code (e.g. by running the API locally and hitting `/openapi.json`, then `pnpm update-api-docs:local`). That step happens once at the merge stage, not in each domain PR.

In a domain PR, your job is the source-of-truth changes:
- FastAPI handler docstrings.
- `Field(description=...)` on request/response models.
- The concept page under `docs/docs/reference/api-guide/`.

Leave the auto-MDX regen to the downstream flow. If your `git status` shows changes under `docs/docs/reference/api/`, revert them before committing: `git checkout origin/<base-branch> -- docs/docs/reference/api/`.

## 9. Before you ship

- Run the docs build (`npm run build` in `docs/`) and fix any errors.
- For API doc changes: run `ruff format` then `ruff check --fix` in `api/`.
- For changelog pages: see `.claude/skills/create-changelog-announcement/SKILL.md` for the dual-entry format and build rules.
- PR title convention: `docs(docs): …` for guide-only, `docs(api): …` for endpoint docstrings, mixed if both. If you have an issue id, prefix: `[issue-id] docs(...): …`.

## 10. Iterate

Start minimal. Ship a draft, get feedback, refine. Don't try to write the perfect page in one pass. Don't restructure whole sections in one PR.

---

## Subagent brief template

Use this as the starting point when delegating doc-writing to a subagent. Fill in the bracketed parts. Always include the "Read first" list so the subagent picks up context.

```
You are writing [domain] documentation for Agenta.

Read first, in order:
1. .claude/skills/write-docs/SKILL.md (this file — the style rules you must follow)
2. tmp-docs-analysis/plan.md (project plan: scope, ordering, PR shape)
3. tmp-docs-analysis/concept-map/<domain>.md (domain research; if it exists)
4. The landed concept pages this work links to (e.g., 04-versioning.mdx)
5. The repo AGENTS.md sections on PR titles and lint commands

What to produce:
- [Concept page path, e.g., docs/docs/reference/api/06-workflows.mdx]
- Docstrings + Field(description=...) for [domain] endpoints in api/oss/src/apis/fastapi/<domain>/

Doc type:
- Concept page is an Explanation in Diátaxis terms.
- Endpoint docstrings are Reference. Keep them dry. No narrative inside docstrings.

Verification:
- Hit each endpoint at least once against eu.cloud.agenta.ai using the saved API key.
- Obfuscate IDs and payloads in examples, but request/response shapes must match the live API.
- If you find a bug, flag it with a repro. Do not paper over it.

Vocabulary:
- Customer-facing only. No "runnable" or "loadable". See §3 of write-docs.

Ship:
- Draft PR via `gh pr create --draft`.
- PR title: `docs(api): <domain> endpoint docstrings + concept page`.
- Run `ruff format` and `ruff check --fix` in api/ before commit.
- Run the docs build in docs/ before commit.

Out of scope:
- [List anything explicitly excluded, e.g., admin endpoints, preview endpoints]
```
