# Template discoverability

Research and proposals for making agent templates visible inside the app (`web/mobile`,
served at `/m`) without taking space from sessions.

The full user journey spec for the chosen surfaces is in [user-journey.md](user-journey.md).

## Problem

People find templates on the website (the "Agent Marketplace" at `/marketplace`), but once
they are in the product they cannot find them again. The constraint: sessions need the
large share of the screen, so the fix cannot be a permanent panel, a second sidebar, or a
strip that sits next to a conversation.

## Where templates live today

| Entry point | File | Who sees it | Why it fails |
| --- | --- | --- | --- |
| Home, "Templates" tab | `web/packages/agenta-home-ui/src/HomeFocus.tsx`, `HomeEntityList.tsx` | Everyone on Home | The tab defaults to "Agents" once a project has one agent. Returning users never see it. It shows 5 rows. |
| First-run strip on `/agents/new` | `web/mobile/src/features/onboarding/FirstRunTemplates.tsx` | People who press "New agent" | One tap on the eye icon hides it **for good, on every surface** (`agenta:templates:strip-hidden` in localStorage). It leaves one grey line. |
| "New agent" dropdown | `web/packages/agenta-home-ui/src/NewAgentButton.tsx` via `features/agents/NewAgentAction.tsx` | People on the Agents list | Behind a click on a button whose label says "agent", not "template". 4 suggestions. |
| Command palette | `web/mobile/src/features/nav/useCommandPaletteGroups.tsx` | Keyboard users | Matches "Templates" / "Browse templates" only. Typing "marketplace" finds nothing. |
| Gallery route `/templates` | `pages/w/[workspace_id]/p/[project_id]/templates/` | Anyone with the URL | **No nav rail entry.** The rail has Home, Agents, Automations, Skills, Sessions, Settings. |
| Website deep link | `web/website/src/lib/useItForFree.ts` → `?template=` → `AuthGate.tsx` | New sign-ups from the site | Works, but only once, at sign-up. |

Two more findings:

- **Name mismatch.** The website says "Agent Marketplace". The app says "Templates". The
  session menu says "Share as template in the marketplace". A user who remembers the
  website looks for a word the app nav does not use.
- **Rail space is a zero-sum budget.** In `useMobileNavItems.tsx` the rail does not scroll;
  only the Sessions group scrolls (`alwaysOpen`, `scrollChildren`). Every fixed row added
  to the rail removes one visible session row. The rail already supports a zero-row slot:
  `groupAction` (Sessions uses it for search and filter), and the footer icon row next to
  the project switcher (Help uses it).

## Design principle

Templates help with one job: **creating an agent**. Show them only where the user is about
to create one. Sessions, Skills, and Automations are about other jobs, so templates do not
belong there. Never put templates beside an active conversation.

Each place below has one role:

- Home **shows** templates.
- The Agents page **offers** them when the list is short.
- Search **finds** them.
- The New agent page is where the user **picks** one.

## Proposals

### 1. Home: banner above the composer

A compact image banner above the Home composer (`HomeFocus.tsx`) presents the templates
("Start from a template" or "From the Marketplace", depending on the name we pick in 5).

- One short strip, about 64–80 px high: 2–3 template tiles or one featured template, plus
  "Browse all N →".
- On a phone, the composer must stay above the fold.
- Dismissible. It comes back when the catalogue adds templates the user has not seen
  (compare catalogue keys to a stored set).
- Home is not a session surface, so this costs sessions nothing.

### 2. Agents page: when the list is short

The Agents list (`features/agents/AgentListScreen.tsx`) offers templates in three states:

- **0 agents.** Template cards replace the text in `states/AgentsEmpty.tsx` ("No agents
  yet").
- **1–2 agents.** A "Start from a template" section of cards sits below the table, in the
  space the short list leaves empty. It goes away at 3 or more agents.
- **Search with no match.** `states/AgentsNoMatch.tsx` shows the templates that match the
  search words. A user who searches "github" and has no GitHub agent sees the GitHub
  templates.

### 3. Command palette: templates are searchable

Today the palette (`features/nav/useCommandPaletteGroups.tsx`) has only two links to the
gallery. Template names are not indexed, so typing "changelog" does not find the
Changelog writer.

- Add a "Templates" group next to Sessions, Agents, Pages, and Actions. A match opens the
  template on `/agents/new?template=<key>`.
- With an empty query, show 2–3 suggested templates in that group.
- Add `marketplace` (and the other word from 5) as search keywords for the gallery link.

### 4. New agent page: collapse instead of hide

`/agents/new` keeps the template strip (`features/onboarding/FirstRunTemplates.tsx`).
Replace its eye-off "hide" with **collapse**: the strip folds to one row of category chips
plus "Browse all". Today one tap sets `agenta:templates:strip-hidden`, which hides
templates on every surface, for good.

### 5. One name everywhere

The website says "Agent Marketplace". The app says "Templates". Pick one noun and use it
on the website, in the banner, on the gallery page, and in the palette.

## Considered and not planned

These were proposed and dropped. They are either too much or in the wrong place.

- **Empty states on Sessions, Automations, and Skills.** These pages are about other jobs.
  Templates there add noise.
- **Prompt after an integration connects** ("3 templates use GitHub"). It interrupts the
  user at a moment that is about something else.
- **A card in the nav rail**, even while the user has few sessions. The rail belongs to
  navigation and sessions.
- **The empty state of a new session.** The user already chose an agent there.
- **The agent overview page.** The user already has this agent.
- **A rail entry, intent matching in the composer, a `/` picker.** Not needed for a first
  version. Revisit only if the four places above do not move the numbers.

## Order

Each step is small and independent.

1. One name (5) and palette search (3). Lowest effort.
2. Agents page states (2).
3. Home banner (1).
4. Collapse instead of hide (4).

## How to measure

The app already sends `captureIntent` events with `source: "template"`,
`"browse_templates"`, and a `surface`. Add the new surface names (`home_banner`,
`agents_empty`, `agents_short_list`, `agents_no_match`, `palette`) and compare:

- Share of agents created from a template, before and after, for users older than 7 days.
- Gallery visits per active user per week.
- Banner dismiss rate, and collapse rate on the New agent strip.
- Session-screen metrics must not change (nothing here touches that screen).
