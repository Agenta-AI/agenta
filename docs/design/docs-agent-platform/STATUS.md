# Status: agent-platform documentation

Written overnight on 2026-07-30. Read this first.

## What was built

28 pages, 3,205 lines, 52 images.

| Section | Pages | Lines |
|---|---|---|
| Getting started | 2 | 180 |
| Learn | 2 | 559 |
| Concepts | 9 | 520 |
| Guides | 11 | 1,052 |
| Reference (developer) | 4 | 894 |

```
Getting started   What is Agenta · Quick start
Learn             Build your first agent · Build a marketing coworker
Concepts          Agents · Skills · Tools and integrations · Files and knowledge ·
                  Permissions · Automations · Harnesses and models ·
                  Sessions and versions · Cost and usage
Guides            11 problem-shaped how-to pages
Contributing      unchanged
Misc              unchanged
```

Developer reference sits in the existing Reference section in the top bar, not in the docs
sidebar: agent configuration, invoke an agent, batch runs, chat message format.

The docs build passes with `onBrokenLinks: throw`, so every internal link resolves.

## How it was written

- `tree.md` — the agreed structure and the decisions inside it.
- `tree-options.md` — the four options considered, and how n8n, Gumloop, Stack AI, and
  Cowork structure their docs.
- `source-material.md` — what the product does, in the founder's words. Treated as true.
- `product-facts.md` — 667 lines of real UI names and click paths, from walking the running
  product, plus an honest list of 11 gaps.
- `WRITER-BRIEF.md` — the contract every writing subagent followed.

Writers were barred from inventing UI labels. Anything not in `product-facts.md` was cut
rather than guessed, and every writer reported what it cut.

## Standing rules applied throughout

- The word "Composio" never appears. Say built-in integrations or connected apps.
- Codex is never named as a harness. Claude Code and Pi only.
- No sub-agents or agents-as-tools.
- Agenta is open source under the MIT license, stated plainly.
- No em dashes, no marketing words.

Verified by grep across all 28 pages.

## What the product told us, that the docs now respect

1. **Permissions are two layers with different option names.** The agent-level policy
   offers `Allow reads`, `Allow all`, `Ask`, `Deny all`. A tool's own dialog offers
   `Allow`, `Ask`, `Deny`, `Inherit`. Built-in tools have no per-tool permission.
2. **`Allow reads` asks for writes, it does not block them.** The first draft said
   otherwise. Corrected after checking `sdks/python/agenta/sdk/utils/types.py` and
   `services/runner/src/permission-plan.ts`.
3. **Per-field version history does not exist.** Those panels carry a `soon` pill. The only
   real configuration history is the Registry page, and that is what the docs point at.
4. **Only `AGENTS.md` exists.** The add-instruction-file control is disabled.
5. **There is no skills catalog.** Add skill opens an authoring dialog; the drop target
   lives only inside it.
6. **The subscription credential is unavailable in the cloud.** Documented as self-hosted
   only, pointing at the existing self-host page rather than duplicating it.

## Still open

**Videos.** Every page outside Reference carries a `{/* VIDEO: ... */}` comment describing
the two to three minute video that belongs there. 23 of them. Only the launch video on
`What is Agenta` is real.

**Two screenshots missing.** `guides/04-add-an-mcp-server.mdx` needs the MCPs section and
the New MCP server drawer. Neither was captured, so the page carries marked placeholders
rather than invented images.

**Questions for Mahmoud.**

1. **There is no batch endpoint.** Nothing in the product accepts a list of inputs. The
   batch page says so plainly and documents the real path instead of inventing one.
2. **Is "turn" a customer-facing word?** The docs define it once as one call to the model
   and use it consistently. If the product does not use it, six pages need one substitution.
3. **The front page says there are two ways to use an agent**, chat and background. The
   reference section adds direct invocation and batch. Worth deciding whether the front page
   should say three.

**Worth fixing separately, found while researching.**

- `docs/docs/reference/openapi.json` is stale. It has no `/services/` path, so it does not
  describe the invoke contract at all, and it lists a `/sessions/states/` route the current
  router does not have.
- `docs/design/agent-workflows/documentation/protocol.md` and
  `docs/design/agent-workflows/interfaces/public-edge/agent-messages.md` both describe a
  `POST /messages` route that no longer exists.
