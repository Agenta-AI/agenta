# Writer brief: Agenta agent-platform documentation

Every subagent writing a page reads this file first, in full. It is the contract.

## Read these before writing a single line

1. `.claude/skills/write-docs/SKILL.md` — the style rules. Section 0, "Write for a reader
   in a situation", governs everything else. Learn it, do not skim it.
2. `.claude/skills/style-editing/SKILL.md` — Williams' clarity principles. Apply them to
   every sentence you write.
3. `docs/design/docs-agent-platform/tree.md` — the documentation tree.
4. `docs/design/docs-agent-platform/product-facts.md` — the real UI names, screens, and
   behaviour. Never write a UI label from memory; take it from this file.
5. `docs/design/docs-agent-platform/source-material.md` — what the product actually does,
   in the founder's own words. This is the content you are turning into pages.
6. One v1 page for tone, for example
   `docs/versioned_docs/version-1.0/concepts/01-concepts.mdx`.

## The reader

A stranger with a job to do. They did not read the PR, they do not know the codebase, and
they do not care about your reasoning. Many of them are AI assistants answering a question
about Agenta on someone's behalf. Write so both a human skimming and a model retrieving
can find the answer.

## The one idea every page serves

ChatGPT gives you a prebuilt general agent that already works for everything. In Agenta
the instructions start empty and you build a custom agent for a job. If a reader does not
get this, nothing else lands.

## Hard rules

- **Never write the word Composio.** Say "built-in integrations" or "connected apps".
  This is absolute.
- **Do not mention Codex as a supported harness.** It has not shipped. Claude Code and Pi
  only.
- **Do not document sub-agents** or using one agent as a tool for another. Not ready.
- **Agenta is open source under the MIT license.** Say it plainly. Never hedge it into
  "open core" and never add licensing caveats.
- **No em dashes.** Use a period, parentheses, or a semicolon.
- **Banned words:** comprehensive, powerful, seamlessly, easily, simply, robust, leverage.
- **Never tell readers what they think** ("you probably want", "this is the part people
  get wrong"). State the fact and let them decide.
- **No opinions.** State constraints as constraints, not advice.
- **Do not touch git.** No commits, no branches, no `but` commands. The orchestrator
  handles all version control.
- **Do not edit** `docs/docs/reference/api/` (auto-generated), `sidebars.ts`, or any file
  outside the pages you were assigned.

## Page shape

Frontmatter on every page:

```
---
title: "Plain label, not a sentence"
sidebar_label: "Short"
description: "One sentence. It is the search result and the AI's summary."
---
```

Every page outside Reference opens with a short paragraph saying what the page is about,
then a video placeholder in this exact form so the orchestrator can find them:

```
{/* VIDEO: <one line describing what the video should show> */}
```

Reference pages get no video.

## Components to use

Import what you use, at the top, inside an `mdx-code-block` fence when the page uses more
than one:

```mdx-code-block
import Image from "@theme/IdealImage";
import Tabs from "@theme/Tabs";
import TabItem from "@theme/TabItem";
```

Images:

```
<Image
  style={{ display: "block", margin: "24px 0" }}
  img={require("/images/agents/<file>.png")}
  alt="Describe what the reader should notice"
  loading="lazy"
/>
```

Only reference images listed in `product-facts.md`. If you need one that does not exist,
write the placeholder comment `{/* SCREENSHOT NEEDED: <exact description> */}` and move
on. Do not invent a filename.

Admonitions, using the types already in these docs:

```
:::info
:::tip
:::warning
:::note
:::caution
```

Use an admonition for a genuine aside or warning. Do not bury a caveat in body prose, and
do not decorate ordinary sentences with them.

## Section rules

**Concepts.** Answer "what is this thing". Lead with the mental model the reader needs to
hold. One worked example beats three abstract paragraphs. End by pointing at the guides
that apply it. Discursive is allowed here, and only here.

**Guides.** The title is the reader's problem, not a feature name. Actions only. No
teaching, no background. Use conditional imperatives: "If you want X, do Y." Branch where
reality branches. Link out for concepts instead of explaining them.

**Learn tutorials.** A guaranteed-success linear path. No branches, no choices, no "you
could also". The reader is learning, so explain each idea at the moment they meet it,
lightly, then link to the concept page for the full version. Everything must work if they
follow it exactly.

**Reference.** Dry. Tables and lists. Every field gets a type, a default, and whether it
is required. No narrative, no "why", no video.

## Length

Short paragraphs. Cut anything that does not serve this reader on this page. A concept
page that cannot be covered by a two to three minute video is too long; split it or cut
it.

## Before you report back

1. Reread every sentence. If you would not say it out loud to a colleague, rewrite it.
2. Check every UI label against `product-facts.md`.
3. Check you used no banned word, no em dash, and never wrote Composio.
4. Confirm every link target exists. Relative doc links look like `/concepts/skills`.

Report back with: the files you wrote, any screenshot placeholders you left, and anything
in the source material you could not verify and therefore left out.
