# Set up your SEO coworker

This agent helps you understand your search opportunities, choose a direction, develop briefs and drafts, prepare publishing, and learn from results. Start small: you do not need every account connected before it can help.

## What is included

- The consultant approach: explain the plan, research before over-asking, deliver a useful first report, and move toward content.
- Eight SEO skills, from learning your business through reviewing and refreshing content. Required third-party license notices travel with their skills.
- A clean editorial workspace at `agent-files/apps/seo-workspace/index.html`, with twelve uncompleted setup items and a proposed writing-style note.
- Generalized playbooks for article formats, research, covers, review and publishing handoffs.
- A plain, direct starting voice, adapted from the original team's style. It is a suggestion, not a claim that you have approved it.

No company research, articles, owner identity, customer information, previous requests, approvals, publishing destination, connection IDs or credentials are included. The original company's logos, fonts and cover designs are not included. App styling is retained; content branding is yours to supply.

## Before you start

Load the package into Agenta as a new agent. It needs normal file access for its notes; the workspace requests read-write access to its own folder. Research needs a search service or an available browser/HTTP alternative. The bundled request validator uses Python 3 and only its standard library. A browser and site-specific build tools are needed when checking rendered pages, not for the first conversation.

The template format does not carry model, harness, runner or sandbox settings, nor an explicit Agenta platform-tool permission list. Use the destination project's normal settings. When you later want schedules, notifications or connection setup, enable the relevant platform tools if that project does not already expose them. The agent must report missing tools rather than pretend a feature is available.

## Connect your own accounts as needed

The package carries these connection requirements, not the author's connections. Their saved policy allows all actions; review that policy when connecting your account.

| Connection | What it helps with | When to add it |
| --- | --- | --- |
| Composio Search (`composio_search`) | Public research and opportunity discovery | Default research connection; reuse a ready project connection if available |
| Context.dev (`context_dev`) | Reading webpages and checking claims | Optional when deeper page reading is needed |
| Peec (`peec_ai_mcp`) | AI-search visibility | Optional; select your own project and verify access |
| fal.ai (`fal_ai`) | Generated covers and images | Optional, for requested asset work |
| Google Search Console (`google_search_console`) | Search performance and indexing evidence | Optional; select your own property and verify access |
| Browserbase (`browserbase_mcp`) | Rendered-page inspection and research captures | Optional; verify browser access on first use |

There are no separately configured MCP servers to add, or custom code/client/reference tools omitted from this package. The Peec requirement above is a gateway integration, despite its integration name.

None of these accounts are preconnected. Private document sources, analytics, a keyword-data provider and publishing access can also be added when useful. Add them only when useful. For GitHub publishing, use `gh` and secure credential setup; create a token at https://github.com/settings/tokens if needed. Never paste credentials in chat. The agent should verify resource access before claiming an account works.

Slack is optional. Click Publish at the top right, choose Slack, follow the instructions and add the agent to a channel. It can then let you know when work is ready or feedback is needed, subject to the platform's send permissions.

## Bring your own context

Send whatever is useful in one batch: website, goals, business stage, audience, competitors, previous articles or calendars, research and links to private materials you want it to read. Say how familiar you are with SEO. Missing details should not prevent a small useful first investigation.

The recipient supplies the company facts, audience, competitors, target queries, authors/reviewers, brand assets, publishing repository or CMS, article format, media destination, measurement properties, channel destination and any future schedule/timezone. No values from the author's company are preselected.

Review the starting voice at `agent-files/00-context/voice-guide.md`. It keeps clear definitions, practical examples, active voice and a low-hype tone. You can change it. Product positioning and company-specific editorial mandates have been removed.

## Use the editorial workspace

Open `agent-files/apps/seo-workspace/index.html` in Agenta. Save a work request, copy the provided message into chat, and let the agent execute that named request. Saving a file alone does not start work or publish anything. The agent validates requests using `actions.json` and `agent-files/playbooks/editorial-workspace/request_state.py`.

The app is the existing implementation with company data removed and the author label generalized. It still reads the current Markdown records at startup and has the existing setup-edit dialogs. The simpler work-with-agent setup dialogs and lazy loading described in the instructions are intended improvements, not features delivered by this export. A saved setup preference does not prove access, agreement or an active schedule.

Brief approval and publish-readiness approval remain separate. Drafts, PRs and live publication are not interchangeable. The owner controls the final publishing action.

## Automations

No schedules or subscriptions belong to the exported agent, so this package contains no automation recipes and activates none. The unrelated project automations were excluded. After a useful manual workflow, you may ask for recurring discovery or measurement. Review scope, timing, timezone and where results should go before creating it.

## First-use check

Send:

> I want help improving SEO for my website: [your URL].
> My main goal is [your goal]. Here is the prior work I have: [links or files].
> Please do a small first investigation, explain what you find, and recommend a direction before we write briefs.

A good first run explains a bounded plan, uses actual available evidence, returns a readable Markdown report with a short chat summary, and asks a small group of useful questions. It does not claim access or results it has not checked, restart an exhaustive intake interview, or draft articles before brief approval.
