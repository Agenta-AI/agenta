# Template discoverability

Research and proposals for making agent templates visible inside the app (`web/mobile`,
served at `/m`) without taking space from sessions.

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

Templates are a **start** activity. Sessions are a **doing** activity. Put templates where
work starts (Home, New agent, empty states, search) and in places that cost zero height
(icon actions, placeholders, slash menus, inline suggestions). Never put them beside an
active conversation.

## Proposals

Each option lists its cost in session real estate.

### 1. A rail entry that costs zero rows (recommended)

Add a "Browse templates" icon action to the **Agents** row via `groupAction`, the same
mechanism the Sessions row uses for search and filter. Hover or focus on the row shows a
`SquaresFour` icon and a `+`; the `+` opens the existing `NewAgentButton` menu (blank or
template), the grid icon opens `/templates`. In the collapsed rail, the Agents flyout gets
a "Templates" child.

```
 Home
 Agents                 [▦] [+]    ← appears on hover/focus, always on touch
 Automations
 Skills
 Sessions               [⌕] [≡]
   ├ …
```

- Cost: **0 rows.**
- Variant 1b: a full "Templates" row under Agents. Cost: 1 row (about 32 px, one session
  row). Honest and simplest; take it if 1 tests poorly.
- Variant 1c: a grid icon in the rail footer beside Help. Cost: 0 rows, but it reads as a
  utility, not a product area.

### 2. Home that opens on templates when it should

Today the tab choice is binary: agents exist → Agents tab. Change the default rule and the
empty space under the composer:

- Show a **one-line chip row under the composer** in task mode: "Start from a template:
  Issue triager · Changelog writer · PR reviewer · Browse all N →". One line, no cards.
  Home has no session content, so this costs nothing that sessions use.
- Put the count on the tab: "Templates N", and a dot when the catalogue has templates
  the user has not seen (compare catalogue keys to a stored set).
- Open on Templates when the project has fewer than 2 agents, not 0.

- Cost: **0** (Home is not a session surface).

### 3. Suggest the template that matches what the user types

When the Home composer is in create mode, or on `/agents/new`, match the typed text
against the catalogue (name, description, category, `templateProviderSlugs`). Show one
inline chip above the composer: "Looks like **Issue triager** — use this template?"
Accepting it binds the template exactly as `selectTemplate` does today.

- Cost: **0** until relevant, then one line inside the composer's own chrome.
- This teaches that templates exist at the exact moment they help. It is the highest-value
  option for returning users who never click "browse".

### 4. Slash command in composers

Type `/` in the Home composer (or `/template`) to open an inline picker over the
composer with search and categories. Same pattern as Slack, Notion, and Linear.

- Cost: **0** (a popover that closes on pick).

### 5. Stop "hide" from being permanent

Replace the eye-off action on the first-run strip with **collapse**: the strip folds to a
single chip row (category chips + "Browse all"), not a grey "Templates hidden · Show
again" line. Keep the full hide only in Settings. The current hide is global, so one
mis-tap removes templates from every surface forever.

- Cost: **0**; it returns space the user already chose to give.

### 6. One name everywhere

Pick one noun. Options:

- Keep **Templates** in the app, and title the gallery "Templates — from the Agent
  Marketplace". Add `marketplace`, `gallery`, `examples`, `starter` as palette keywords.
- Or rename in-app to **Marketplace**, matching the website and the "Share in the
  marketplace" action.

Either way, add the palette keywords. It is a one-line change in
`useCommandPaletteGroups.tsx` (`matches(q, action.label, [...])`).

- Cost: **0.**

### 7. Contextual moments (later)

Short, dismissible prompts at moments where a template is the obvious next step:

- After the user connects an integration (GitHub, Slack, Linear): "3 templates use
  GitHub" toast with a link to the gallery filtered by that provider.
- On the Agents list when it has fewer than 3 rows: a "Start from a template" row after
  the last agent, inside the table's own empty area.
- The empty Sessions list: "No sessions yet — start one from a template".

- Cost: **0** (they use space that is already empty).

## What not to do

- A templates panel or strip on the session screen. It competes with the transcript.
- A second rail or a pinned card in the rail. Each fixed row removes a session row.
- An announcement banner as the main fix. It works once, then people learn to ignore it.

## Recommendation

Ship in this order. Each step is small and independent.

1. Palette keywords and one name (6). Lowest effort.
2. Zero-row rail entry on Agents (1). Fixes "there is no way to get there".
3. Collapse instead of hide (5), and the Home chip row plus tab count (2).
4. Intent matching in the composer (3). Largest effect on returning users.
5. Slash picker (4) and contextual moments (7) after we measure 1–4.

## How to measure

The app already sends `captureIntent` events with `source: "template"`,
`"browse_templates"`, and a `surface`. Add the new surface names (`rail`, `home_chips`,
`intent_match`, `slash`, `palette`) and compare:

- Share of agents created from a template, before and after, for users older than 7 days.
- Gallery visits per active user per week.
- Hide/collapse rate on the first-run strip.
- Session-screen metrics must not change (nothing here touches that screen).
