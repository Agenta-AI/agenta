"""Knowledge-category template playbooks (Q&A bots, docs, content).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

_DOCS_QA_BODY = """\
# Docs Q&A playbook

## Match
The ask is "answer questions from our docs/workspace with cited answers" or similar. Card key
docs-qa. Also matches free-text asks for an internal wiki bot, docs bot, or "ask our knowledge
base" agent for teammates (not customers; see knowledge-chatbot for a customer-facing bot).

## Required context (ask via one request_input form)
- Channel to answer @mentions in: which Slack channel(s) the agent should listen in and reply
  in. The agent cannot know this; set the field default to a channel a prior read surfaced,
  and leave no default otherwise.
- What counts as "the docs": the Notion space or top-level pages to search, if the connected
  workspace holds more than docs (product specs, meeting notes, and so on). Description:
  "Leave empty to search the whole connected workspace."

## Researchable context (ask, defaulting to "figure it out")
- Additional sources beyond Notion: also search Confluence, Google Drive, or Slack history if
  connected. Multi-select ({type: "array", items: {type: "string", enum: [...]}}) with default
  ["Figure it out from what's connected"]. Note: naming sources now saves a research pass.

## Explore first (read before proposing)
1. discover_tools for the Notion search and page-read tools (and Confluence/Drive/Slack reads
   if connected).
2. test_run with those tools in the delta, ask a real question from the workspace, and check
   the draft answer actually cites a page that exists.

## Defaults / priors table (sources connected to proposed setup)
| Sources connected | Trigger | Tools | Behavior default |
|---|---|---|---|
| Notion only | mention | search + fetch page | search Notion, answer with page citations |
| Notion + Confluence/Drive | mention | search both + fetch | search all, cite whichever source matched |
| Notion + Slack | mention | search + fetch + Slack search | also search pinned/linked Slack threads |

## Connections
Notion is required. Confluence, Google Drive, and Slack (as an extra source) are optional
alternatives or additions; request_connection only for what is missing and actually used.

## Instructions template (what to commit)
On each @mention: read the question, search Notion (and any other connected source) with the
exact search tool, and fetch the top matching pages' content. If relevant content is found,
answer using only that content and cite each source page by title and link. If nothing relevant
is found, say so plainly and stop; do not invent an answer. Finish by replying in the thread the
mention came from with the exact send-message tool.

Output shape:
    <answer>

    Sources:
    - <page title> (<link>)

## Verify
1. test_run with an artificial mention-shaped message ("@docs-bot how do I reset my API key?")
   and read the verdict and the tools line, not a 200.
2. Fire an artificial test message first; if it passes, ask the user to run the real trigger
   test with the Lightning "Test event" button.
3. Confirm the reply landed in the right channel/thread.

## Closing report
What the agent became, which sources it searches, which channel it answers in, what you
verified, and any connection the user still needs to authorize.
"""

_KNOWLEDGE_CHATBOT_BODY = """\
# Knowledge chatbot playbook

## Match
The ask is "build a customer-facing chatbot that answers questions from our knowledge base" or
similar. Card key knowledge-chatbot. Matches free-text asks for a support bot, FAQ bot, or
"answer customer questions" agent reachable over Slack, Discord, or Telegram (for an internal
teammate-only bot, see docs-qa instead).

## Required context (ask via one request_input form)
- Where customers reach it: which Slack channel, Discord server/channel, or Telegram chat the
  agent should listen and reply in. No default; the agent cannot know this.
- Which Notion content is customer-safe: the space or pages that are fine to show customers,
  excluding anything internal-only. Description: "Leave empty to search the whole connected
  workspace" if there is no internal/external split.

## Researchable context (ask, defaulting to "figure it out")
- Tone: match the brand voice found in existing customer-facing pages, or a plain, neutral
  tone. Enum with default "Figure it out from the docs I find."

## Explore first (read before proposing)
1. discover_tools for the Notion search/fetch tools and the reply tool for the chosen platform
   (Slack, Discord, or Telegram).
2. test_run with those tools, ask a realistic customer question, and check the draft only uses
   customer-safe content.

## Defaults / priors table (platform to proposed setup)
| Platform | Trigger | Tools | Behavior default |
|---|---|---|---|
| Slack | mention | Notion search + fetch + Slack reply | answer in-thread with citations |
| Discord | mention | Notion search + fetch + Discord reply | answer in-thread with citations |
| Telegram | event (message) | Notion search + fetch + Telegram reply | answer inline with citations |

## Connections
Notion is required for the knowledge base. Exactly one reply platform (Slack, Discord, or
Telegram) must be connected; request_connection for the missing one and stop.

## Instructions template (what to commit)
On each incoming question: search the customer-safe Notion content with the exact search tool,
then fetch the top matching pages. If relevant content is found, answer using only that content
in a plain, friendly tone and cite each page. If nothing relevant is found, say so plainly and
offer to escalate to a human; do not invent an answer. Finish by sending the reply on the
platform it arrived on with the exact send tool.

Output shape:
    <answer>

    Sources:
    - <page title> (<link>)

## Verify
1. test_run with an artificial mention/message ("Do you support refunds after 30 days?") and
   read the verdict and the tools line, not a 200.
2. Fire an artificial test message first; then ask the user to run the real trigger test with
   the Lightning "Test event" button.
3. Confirm the reply appears on the right platform and channel.

## Closing report
What the agent became, which content it can see, which platform it answers on, what you
verified, and anything (a connection, a customer-safe scoping decision) still needed.
"""

_ONBOARDING_BUDDY_BODY = """\
# Onboarding buddy playbook

## Match
The ask is "build an onboarding buddy that answers new-hire questions from our internal wiki"
or similar. Card key onboarding-buddy. Matches free-text asks for a new-hire bot, "ask HR/eng
wiki" agent, or first-week helper (an external customer-facing bot is knowledge-chatbot, not
this one).

## Required context (ask via one request_input form)
- Channel to answer @mentions in: which Slack channel new hires will ask in (often a
  #onboarding or #new-hires channel). No default; the agent cannot know this.
- Which wiki counts as "the internal wiki": the Notion or Confluence space to search, if the
  workspace holds more than onboarding content. Description: "Leave empty to search the whole
  connected workspace."

## Researchable context (ask, defaulting to "figure it out")
- Which topics to prioritize (benefits, tools setup, team structure): a multi-pick, so use
  multi-select ({type: "array", items: {type: "string", enum: [...]}}) with default
  ["Figure it out from what the wiki covers"].

## Explore first (read before proposing)
1. discover_tools for the Notion (or Confluence) search and page-read tools.
2. test_run with those tools, ask a realistic new-hire question, and check the draft cites a
   real page and reads as approachable, not just a link dump.

## Defaults / priors table (wiki shape to proposed setup)
| Wiki shape | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single company wiki | mention | search + fetch page | search the whole space, answer with citations |
| Per-team wiki spaces | mention | search + fetch page | search the new hire's team space first, then the rest |
| Notion + Confluence both | mention | search both + fetch | search both, cite whichever source matched |

## Connections
Notion (or Confluence) is required. Slack is the reply channel; request_connection for
whichever is missing and stop.

## Instructions template (what to commit)
On each @mention: read the question, search the wiki with the exact search tool, and fetch the
top matching pages. If relevant content is found, answer in a warm, approachable tone and cite
each page by title and link. If nothing relevant is found, say so plainly and suggest who to ask
instead if known; do not invent an answer. Finish by replying in the thread with the exact
send-message tool.

Output shape:
    <answer>

    Sources:
    - <page title> (<link>)

## Verify
1. test_run with an artificial mention-shaped message ("@onboarding-buddy where do I request a
   laptop?") and read the verdict and the tools line, not a 200.
2. Fire an artificial test message first; then ask the user to run the real trigger test with
   the Lightning "Test event" button.
3. Confirm the reply landed in the right channel/thread.

## Closing report
What the agent became, which wiki it searches, which channel it answers in, what you verified,
and any connection still needed.
"""

_CONTENT_REPURPOSER_BODY = """\
# Content repurposer playbook

## Match
The ask is "turn a published doc into draft LinkedIn and X posts for review" or similar. Card
key content-repurposer. Matches free-text asks to repurpose a blog post, doc, or changelog
entry into social copy (this is a one-shot transform, not a standing Q&A bot).

## Required context (ask via one request_input form)
- Source doc: the Notion page or Google Drive doc to repurpose. The agent cannot proceed
  without it. Set the field default to the doc a prior read surfaced; leave no default
  otherwise.
- Where to post drafts for review: a Slack channel or a Notion draft page. Offer as an enum
  with default "Figure it out from what's connected."

## Researchable context (ask, defaulting to "figure it out")
- Which platforms to draft for (LinkedIn, X, or both): a multi-pick, so use multi-select
  ({type: "array", items: {type: "string", enum: ["LinkedIn", "X"]}}) with default
  ["LinkedIn", "X"] (draft both).

## Explore first (read before proposing)
1. discover_tools for the source-read tool (Notion or Drive) and the draft-post tool (Slack
   message or Notion page create).
2. test_run against the real source doc and draft one example post before wiring the full
   setup.

## Defaults / priors table (source to proposed setup)
| Source | Trigger | Tools | Behavior default |
|---|---|---|---|
| Notion doc | manual | fetch page + Slack/Notion write | repurpose into LinkedIn + X drafts, post for review |
| Google Drive doc | manual | fetch doc + Slack/Notion write | same, reading from Drive instead |

## Connections
Notion is required (as source or draft target). Google Drive is a swappable source; Slack is
the review channel if chosen. request_connection for whichever is missing and stop.

## Instructions template (what to commit)
On request: fetch the source doc with the exact fetch tool. Draft one post per requested
platform, grounded strictly in the doc's own content and claims; never invent statistics or
quotes the doc does not contain. Each draft links back to the source doc. If the doc lacks
enough substance for a platform, say so instead of padding with invented detail. Finish by
posting the drafts to the review channel or draft page with the exact write tool.

## Verify
1. test_run with a blunt message ("Repurpose this doc into LinkedIn and X drafts") and read the
   verdict and the tools line, not a 200.
2. This template has no trigger to verify; it runs on demand by chatting with the agent.
3. Read back the posted drafts to confirm they landed in the review channel or page.

## Closing report
What the agent became, which doc it read, where drafts post, what you verified, and any
connection still needed.
"""

_NEWSLETTER_DRAFTER_BODY = """\
# Newsletter drafter playbook

## Match
The ask is "draft a weekly newsletter from our recent shipping activity" or similar. Card key
newsletter-drafter. Matches free-text asks for a "what shipped this week" digest turned into a
newsletter draft (for a Slack-only digest with no draft doc, see repo-slack-digest in Ops).

## Required context (ask via one request_input form)
- Where to draft the newsletter: which Notion page or database to write the weekly draft into.
  No default; the agent cannot know this.

## Researchable context (ask, defaulting to "figure it out")
- Which sources to pull from: GitHub merged PRs, Linear completed issues, or both. A
  multi-pick, so use multi-select ({type: "array", items: {type: "string", enum: [...]}})
  with default ["Figure it out from what's connected"].
- Send day/time: enum with default "Monday 09:00 local"; the built-in Other… option covers a
  custom time.

## Explore first (read before proposing)
1. discover_tools for the GitHub (merged PRs) and/or Linear (completed issues) read tools, and
   the Notion page write tool.
2. test_run with those tools against the real repo/workspace, and draft one example week's
   newsletter before wiring the full setup.

## Defaults / priors table (sources connected to proposed setup)
| Sources connected | Trigger | Tools | Behavior default |
|---|---|---|---|
| GitHub only | weekly schedule | list merged PRs + Notion write | group merges into shipped items, draft, save |
| Linear only | weekly schedule | list completed issues + Notion write | group completed issues, draft, save |
| GitHub + Linear | weekly schedule | both reads + Notion write | merge both into one draft, dedupe by ticket link |

## Connections
Notion is required as the draft target. GitHub and Linear are swappable sources; use whichever
is connected, or both. request_connection only for the source the user picks that is missing.

## Instructions template (what to commit)
On the weekly run: read merged PRs and/or completed issues since the last run with the exact
list tool(s). Group them into sections (shipped, fixed, in progress) grounded only in what the
tools return; never invent items. Each entry links back to its PR or issue. Draft the newsletter
in the output shape below and finish by writing it into the pinned Notion page with the exact
write tool.

Output shape:
    ## Week of <date>
    ### Shipped
    - <item> (<link>)
    ### Fixed
    - <item> (<link>)

## Verify
1. test_run with a blunt message ("Draft this week's newsletter from recent shipping activity")
   and read the verdict and the tools line, not a 200.
2. Fire an artificial scheduled-run test message first; if it passes, ask the user to run the
   real trigger test with the Play "Run" button.
3. Read back the Notion page to confirm the draft landed.

## Closing report
What the agent became, which sources it reads, where it drafts, what is scheduled, what you
verified, and any connection still needed.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="docs-qa",
        name="Docs Q&A",
        category="Knowledge",
        match="Answer questions from our docs or workspace with cited answers",
        body=_DOCS_QA_BODY,
    ),
    TemplateEntry(
        key="knowledge-chatbot",
        name="Knowledge chatbot",
        category="Knowledge",
        match="Build a customer-facing chatbot that answers questions from our knowledge base",
        body=_KNOWLEDGE_CHATBOT_BODY,
    ),
    TemplateEntry(
        key="onboarding-buddy",
        name="Onboarding buddy",
        category="Knowledge",
        match="Answer new-hire questions from our internal wiki",
        body=_ONBOARDING_BUDDY_BODY,
    ),
    TemplateEntry(
        key="content-repurposer",
        name="Content repurposer",
        category="Knowledge",
        match="Turn a published doc into draft LinkedIn and X posts for review",
        body=_CONTENT_REPURPOSER_BODY,
    ),
    TemplateEntry(
        key="newsletter-drafter",
        name="Newsletter drafter",
        category="Knowledge",
        match="Draft a weekly newsletter from our recent shipping activity",
        body=_NEWSLETTER_DRAFTER_BODY,
    ),
]
