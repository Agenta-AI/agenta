# User journey spec: template discoverability

This spec describes how a user finds, picks, and uses a template in the app (`web/mobile`,
served at `/m`). It covers the four surfaces agreed in [README.md](README.md): the Home
banner, the Agents page, the command palette, and the New agent page. It is a UX spec. It
does not prescribe components or state shape beyond what the behavior needs.

"Templates" is a placeholder for the product noun. The team still has to choose between
"Templates" and "Marketplace" (see [Open questions](#open-questions)). Every user-facing
string below uses the placeholder.

## Rules that hold on every surface

1. **Templates appear only where the user is about to create an agent.** Never on Sessions,
   Automations, Skills, an agent's overview, or inside a session.
2. **One screen never shows templates twice.** If a surface already lists templates, no
   second template element appears on that screen. A plain link to the gallery (such as
   the Agents page header button) is navigation, not a template element, so it does not
   count.
3. **A pick never creates silently.** Every pick lands on the New agent page with the
   template loaded, the prompt editable, and the connect step (if any) visible. The user
   presses Create.
4. **Dismissals are local to one surface.** Closing the Home banner does not hide the
   templates on the Agents page or the New agent page. This replaces today's single
   global flag, `agenta:templates:strip-hidden`.
5. **A catalogue that is loading or failed is never shown as "no templates."** Loading shows
   a skeleton. Failure shows the existing `LoadError` with a retry, or hides the element
   where a retry does not fit (see each surface).

## Personas

| ID | Who | Agents in project | How they arrive |
| --- | --- | --- | --- |
| P1 | New user from the website | 0 | Clicked "Use it for free" on a Marketplace template page |
| P2 | New user, organic sign-up | 0 | Signed up without a template in mind |
| P3 | Early user | 1–2 | Built one or two agents, comes back to build more |
| P4 | Established user | 3 or more | Works mostly in sessions |
| P5 | Keyboard user | any | Uses the command palette to move around |

## The shared ending: pick → New agent → session

Every journey below ends in the same pipeline. It exists today. This spec does not change
it, except for the strip's collapse control (surface 4).

1. **Pick.** The user picks a template on any surface.
2. **Land.** The app opens `/agents/new?template=<key>`
   (`useNewAgentAction.createFromTemplate` → `FirstRunScreen`).
   - The hero title names the template. The subtitle is the template's `description`.
   - The template strip folds away.
   - The editor holds the template's builder prompt. The user can edit it. "Reset" brings
     the original back.
   - If the template needs accounts, the connect card docks in the composer. Create stays
     disabled until the required accounts are connected.
   - The config pane is available, collapsed by default.
3. **Create.** The user presses Create. The agent is created and the session opens. The
   first turn starts.
4. **Back out.** The ✕ on the connect card, or dismissing the step, returns to blank
   create. The URL drops `?template=`. An unedited template prompt is cleared. An edited
   prompt stays.

Edge states on landing (already handled today):

| State | What the user sees |
| --- | --- |
| Catalogue still loading | Hero skeleton. Create is held so the typed text does not turn into a blank agent. |
| Catalogue failed | Error line with "Try again". Create is allowed; it makes a blank agent. |
| Key not in catalogue | `UNAVAILABLE_TEMPLATE_MESSAGE`. Blank create is offered. |

## Visibility by agent count

"Agents" means active (not archived) agents in the current project, unfiltered.

| Surface | 0 agents | 1–2 agents | 3+ agents |
| --- | --- | --- | --- |
| Home banner | Hidden (the list below is already on the Templates tab; rule 2) | Shown unless dismissed | Shown unless dismissed |
| Home list, Templates tab | Default tab | Second tab | Second tab |
| Agents page, empty state | Template grid | — | — |
| Agents page, short-list section | — | Shown (no search or filter active) | Hidden |
| Agents page, search with no match | — (there are no agents to search) | Matching templates | Matching templates |
| Agents page, header "Templates" button | Shown | Shown | Shown |
| Command palette, Templates group | Shown | Shown | Shown |
| New agent page, strip | Expanded, or collapsed if the user collapsed it | same | same |

---

## Surface 1: Home banner

### Purpose

Show returning users that templates exist, on the page where they start work.

### Placement

- Above the composer, below the greeting ("What should we work on?"), in the same
  620 px column as the composer (`HomeFocus.tsx`).
- Height: 64–80 px on desktop. On a phone it is one row that scrolls sideways. The
  composer must stay above the fold on a 667 px-tall screen.

### Content

- A label: "Start from a template".
- 3 template tiles: monogram, name, and provider marks (`TemplateProviderMarks`). On a
  phone the tiles scroll sideways and show about 2.5 tiles, so the cut-off tile signals
  more.
- A link on the right: "Browse all N →", which opens `/templates`.
- A close control (✕) at the top right, with the label "Hide templates on Home".

Which 3 templates: templates the user has not created an agent from, in catalogue order.
If fewer than 3 are left, fill from the start of the catalogue.

The app catalogue has no image field today (the website has media). The first version
builds the visual from the monogram colors and provider marks. A real image needs a
catalogue field (see [Open questions](#open-questions)).

### Visibility

Show the banner when all of these are true:

- The catalogue loaded and has at least 1 template.
- The project has 1 or more agents (rule 2: at 0 the list is already on Templates).
- The Home list is on the Agents tab. If the user switches the list to Templates, the
  banner folds away and comes back when they switch back.
- The user has not dismissed it, or the catalogue has templates added since the dismissal.

While the catalogue loads, reserve no space. The banner appears when the data is ready,
with the `HeightCollapse` fold the page already uses. A failed catalogue hides the banner
with no error (the Templates tab carries the retry).

### Interaction

| Action | Result |
| --- | --- |
| Click a tile | Binds the template to the Home composer, exactly as a row in the Templates tab does (`selectTemplate`): the composer switches to create mode, the prompt fills in, the caret moves there. Send runs the shared ending. |
| Click "Browse all N →" | Opens `/templates`. |
| Click ✕ | The banner folds away. The app stores the catalogue keys it knew at that moment. |
| New templates arrive later | The banner comes back once, and features the new templates first. |

Persistence: `agenta:templates:home-banner-dismissed` in localStorage holds the list of
keys known at dismissal. The banner shows again if the current catalogue has a key that is
not in that list.

### Journey: P3 comes back to Home

1. P3 opens the project. Home shows the greeting, the banner, the composer, and the Agents
   list.
2. P3 sees "Issue triager" in the banner and clicks it.
3. The composer switches to create mode with the Issue triager prompt. The banner stays; the
   tile is marked as selected.
4. P3 edits one line and presses Send.
5. The shared ending runs: New agent page → connect GitHub → Create → session.

### Journey: P4 does not want the banner

1. P4 opens Home and clicks ✕ on the banner.
2. The banner folds away. The composer moves up. The Agents list is unchanged.
3. Two weeks later the catalogue adds two templates. The banner comes back once with those
   two first. If P4 closes it again, it stays closed until the next addition.

---

## Surface 2: Agents page

The Agents page (`features/agents/AgentListScreen.tsx`) has one entry that is always
there, and three template states that depend on the list. The states sit inside the list
area, under the toolbar. None adds a new bar or rail.

### Always: "Templates" button in the page header

The Agents page always has a way to reach the gallery, whatever the agent count, search,
or filters.

- **Placement:** in the page header row, directly left of "New agent", on the same row as
  the "Agents" title. The row already exists, so the button adds no height.
- **Look:** a secondary (outline or ghost) button, so "New agent" stays the primary action.
  Grid icon (`SquaresFour`, the icon the palette already uses for templates) and the label
  "Templates".
- **Phone:** icon only, same height as "New agent" (`h-control-sm`). It keeps an
  `aria-label` and a tooltip ("Browse templates"), because the title and "New agent" already
  fill the row.
- **Click:** opens `/templates`.
- **Always rendered.** It does not depend on the catalogue state: the gallery page handles
  its own loading and error. It has no count, so it never shows a loading or "0" state.
- **Not dismissible.** It is navigation, like the rail items.

This is the fixed route to the gallery. The states below are the offers that appear only
when they help.

```
 ☰  Agents                                   [▦ Templates]  [+ New agent ▾]
 [ Search agents by name…      ]  [Filter]                        [≡ ▦]
 ───────────────────────────────────────────────────────────────────────
 rows…
```

### State A: 0 agents

Replaces the text in `states/AgentsEmpty.tsx`.

- Title: "No agents yet".
- One line: "Start from a template, or create a blank agent with New agent above."
- A grid of 6 template cards (`TemplateCard`): 3 across on desktop, 1 column on a phone.
- A link below the grid: "Browse all N templates →", which opens `/templates`.
- Catalogue loading: the grid shows card skeletons. Catalogue failed: the grid is replaced
  by `LoadError` with a retry. The title and line stay.

Card click → `createFromTemplate(key)` → the shared ending.

### State B: 1–2 agents

A section below the table rows:

- Heading: "Start from a template".
- 3 cards in one row on desktop; a sideways scroller on a phone.
- "Browse all N →" at the right of the heading.
- No close control. The section goes away by itself when the project reaches 3 agents.

Shown only when no search term and no filter is active. With a search or filter the list
is about finding an agent, not making one.

Catalogue loading: no space is reserved. Catalogue failed: the section is hidden with no
error.

### State C: search with no match

Extends `states/AgentsNoMatch.tsx` when a search term is present.

- The existing title ("Nothing matches "github"") and "Clear search" button stay first.
- Below them, when templates match the term: "Templates that match "github"" and up to 3
  cards.
- Matching: case-insensitive substring on template `name`, `description`, `category`, and
  provider slugs (`templateProviderSlugs`).
- When no template matches, the state is exactly as today.
- A filter-only no-match (no search term) shows no templates.

### Journey: P2 opens Agents for the first time

1. P2 clicks Agents in the rail. The list shows "No agents yet" and 6 template cards.
2. P2 clicks "Browse all N templates →" (or the header "Templates" button). The gallery
   opens.
3. P2 opens a template's detail page, reads it, and clicks "Use this template".
4. The shared ending runs.

### Journey: P4 wants a new agent from the gallery

1. P4 has 12 agents. The Agents page shows no template section.
2. P4 clicks "Templates" in the header. The gallery opens.
3. P4 filters by category, opens a template, and clicks "Use this template".
4. The shared ending runs.

### Journey: P3 searches for an agent they do not have

1. P3 types "slack" in the Agents search. No agent matches.
2. The page shows "Nothing matches "slack"", the "Clear search" button, and 2 templates
   that use Slack.
3. P3 clicks one. The shared ending runs.

---

## Surface 3: Command palette

`features/nav/useCommandPaletteGroups.tsx`, opened with ⌘K / Ctrl+K or the Search control
on the Sessions row.

### Changes

- A new group, **Templates**, placed after Agents.
- **Typed query:** match template `name`, `description`, `category`, and provider slugs.
  Show up to `MATCH_CAP` (8) results. Each row shows the monogram tile as its icon and the
  category as its hint.
- **Empty query:** show 3 suggested templates, chosen the same way as the Home banner.
- **Select a row:** open `/agents/new?template=<key>` (the shared ending).
- The existing "Templates" page link and "Browse templates" action stay. Add search
  keywords for them: `marketplace`, `gallery`, `examples`, `starter`.
- Catalogue loading or failed: the group is left out. The palette does not show an error.

### Journey: P5 wants a changelog agent

1. P5 presses ⌘K and types "changelog".
2. The Templates group shows "Changelog writer". The Pages group shows nothing that matches.
3. P5 presses Enter. The New agent page opens with the template loaded.
4. The shared ending runs.

### Journey: P1 remembers the website

1. P1 signed up from a Marketplace page a week ago and wants another template.
2. P1 presses ⌘K and types "marketplace".
3. "Browse templates" matches through its keyword. P1 presses Enter and the gallery opens.

---

## Surface 4: New agent page

`/agents/new`, where every New agent entry lands (`FirstRunScreen.tsx`,
`FirstRunTemplates.tsx`).

### Change: collapse instead of hide

Today the eye-off control sets `agenta:templates:strip-hidden`. The strip becomes one grey
line ("Templates hidden · Show again"), and the flag hides templates everywhere.

New behavior:

- The eye-off control becomes a **collapse** control (chevron-up icon, label "Collapse
  templates").
- **Collapsed**, the strip is one row: the "Templates" label, the category chips with their
  counts, "Browse all N", and an expand control (chevron-down, "Show templates").
- Clicking a category chip in the collapsed row expands the strip with that category
  selected.
- The collapsed state persists in `agenta:templates:strip-collapsed`. It affects this
  page only.
- Migration: when `agenta:templates:strip-hidden` is `true`, start collapsed, then stop
  reading the old key.

Everything else on the page stays as it is: the pick folds the strip away and docks the
connect card; dismissing the step brings the strip back in its previous state (category
and page kept).

### Journey: P2 collapses the strip, then needs it

1. P2 opens New agent, wants to type a description, and collapses the strip.
2. The strip becomes one row. The composer has more room.
3. P2 gets stuck, clicks the "Ops" chip in the collapsed row, and the strip expands
   on Ops.
4. P2 picks a template. The shared ending runs.

---

## The website journey (P1), end to end

This path exists today. The spec lists it so the surfaces above are seen in order.

1. P1 reads a template page on the website Marketplace and clicks "Use it for free".
2. The link carries `?template=<key>`. `AuthGate` stores the key through sign-up.
3. After sign-up P1 lands on `/agents/new?template=<key>`. The shared ending runs.
4. Later P1 comes back. P1 finds templates again through:
   - the Home banner (from the first agent on),
   - the Agents page short-list section (at 1–2 agents),
   - the command palette, by name or with "marketplace".

## Analytics

The app already sends `captureIntent` events. Add one `surface` value per entry point, on
the same `source: "template"` event the pick sends today:

| Surface value | Sent when |
| --- | --- |
| `home_banner` | A banner tile is clicked |
| `agents_empty` | A card in state A is clicked |
| `agents_short_list` | A card in state B is clicked |
| `agents_no_match` | A card in state C is clicked (also send the search term's length, not the term) |
| `palette` | A Templates group row is selected |
| `onboarding` | A strip card is picked (exists today) |

Also send:

- `templates_banner_dismissed` when the ✕ is clicked.
- `templates_strip_collapsed` / `templates_strip_expanded` on the New agent page.
- `browse_templates` (exists) with the `surface` that sent the user to the gallery. The
  Agents page header button sends `surface: "agents_header"`.

## Acceptance criteria

- No template element appears on Sessions, Automations, Skills, an agent overview, or a
  session screen.
- No screen shows two template elements at once.
- The Agents page header shows the "Templates" button in every state: 0, 1–2, and 3+
  agents, with or without search and filters, and while the catalogue loads or fails.
- Every pick lands on `/agents/new?template=<key>` or binds the Home composer; none creates
  an agent without the user pressing Create or Send.
- Closing the Home banner does not change the Agents page or the New agent page.
- The banner never pushes the Home composer below the fold on a 375 × 667 screen.
- A loading or failed catalogue never renders as an empty list or "0 templates".
- Keyboard: every card, tile, chip, and control is reachable with Tab and works with Enter
  and Space; the palette group works with arrow keys like the other groups.
- Reduced motion: the banner and strip folds follow `src/lib/motion` reduced-motion rules.

## Open questions

1. **Name.** "Templates" or "Marketplace"? The website, banner, gallery title, and palette
   must use the same word.
2. **Banner image.** Build the visual from monograms and provider marks, or add a media
   field to the app catalogue (the website data already has media)?
3. **Banner click.** Bind the Home composer (consistent with the Templates tab, this spec)
   or go straight to the New agent page (consistent with every other surface)?
4. **Short-list threshold.** Is 3 agents the right point to hide the Agents page section?
5. **Home Templates tab.** With the banner in place, does the second tab still earn its
   place for users with agents?
