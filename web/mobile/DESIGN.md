# Agenta design system

The design system for `web/mobile` (served at `/m`), the only Agenta frontend. Read this file before any UI change. If a case is not covered, ask; do not invent a rule.

Each fact has one home:

| What | Where |
| --- | --- |
| The glossary, the principles, the layout and the patterns | This file |
| The values: colors, text styles, sizes, radii, shadows, motion, and where each one is used | `src/design/theme.config.ts` |
| The rules, each with an ID, a reason, an Avoid and a Do, and the icon of each product term | `src/design/rules.json` |
| A live Do and Avoid example for each rule | `/m/design-system`, which reads `rules.json` |

## Glossary

One word for one thing. Use these words in code, comments, docs and reviews.

| Word | Means | Do not say |
| --- | --- | --- |
| Theme variable | A named value from `theme.config.ts`: `--muted`, `bg-muted`, `text-label`, `control-md`. `tokens.json` exports them for design tools. | token (the word stays only in the legacy script names and in `tokens.json`) |
| Kit | The shared components in `@agenta/ui/ui` (source `web/packages/agenta-ui/src/components/ui/`). | primitives library, shadcn folder |
| Mark | The square tile with an icon or a letter that stands for an entity. The component is `IconTile`. | avatar, letter tile, icon tile |
| Compact window | A window under 640px (`breakpoint-sm`). Medium is 640–1023px, expanded is 1024px and up. | phone, small screen, mobile |
| Touch | A coarse pointer (`pointer: coarse`). It is not a window size: a tablet is touch on a medium window. | mobile |
| Agent chat | A chat with the agent about the open item. It opens in the right pane. | agent pane |
| Alignment line | The left edge of the page title. Text, visible edges and the first Mark sit on it; only a hover fill hangs outside. | anchor line |
| Hover fill | `accent`, the one fill for hover. | hover color |

## Principles

1. **Theme variables name a job, not a look.** Write `bg-muted text-muted-foreground border-border-muted`. Never a hex value, a stock Tailwind color or an antd name.
2. **Components own their size.** A caller passes `size="sm"`. Height, padding, radius, text and icon size come from the component. `className` is for layout only.
3. **Tone separates areas, borders separate items.** An area that must stand apart gets a different surface (`muted` on `background`), not another border.
4. **One primary action per view.** Color points at one thing: the `default` (primary) button. Everything else is quiet.
5. **Hierarchy from weight and tone first, size last.** Weight shows rank, never state.
6. **Quiet, not loud.** No bold text, no thick lines, no large saturated fills, no heavy shadows. Emphasis comes from `foreground` against `muted-foreground`.
7. **The same thing looks the same everywhere.** An entity, an action or a list has one size, one label and one icon on every screen. Take it from the tables here, not from the screen you are on.
8. **Every view has four states:** loaded, empty, loading and error.

## Layout and windows

- A general page has the sidebar, the content column and the right pane. Its title row holds the title and the page actions, and no bar runs across the top.
- A workbench page (the session playground, the Builder, the Playground, the trace view) has a bar across the top and uses the full width, because it holds too many controls for a title row.
- The right pane is one slot in the layout that any page can fill: an item's details, the agent chat, a preview, help.
- The content column is centered. Lists are the widest, item pages and Home are narrower, and settings are the narrowest.
- Only the body scrolls.
- A component that sits in panes of different widths (a list, a card, the composer) adapts with container queries, not window media queries.

## Patterns

### Page

1. The title row: the title, a one-line description, and the page actions on the right.
2. A toolbar row: the search field, then filters.
3. Tabs, if the page has sibling views.
4. The content: a list, a settings form, or a session.

### List

One row shape: a Mark, a title, an optional meta line, an optional status badge, and up to two row actions.

### Form and settings

- `Field` around every control: the label above (forms) or on the left (settings rows), the error below.
- One Save for the section, right-aligned. A switch that applies at once needs no Save.

### Session

- Tool calls are chips above the agent's answer.
- Message actions (copy, retry) show on hover, and always on the last turn.
- The Composer is pinned at the bottom, above the keyboard on a compact window.
- Running work shows as an `info` badge with a spinner, or a progress bar in the row.

### Compact window

- Page actions that do not fit in the compact header go in More.
- Top-level pages are Home, Agents, Automations, Skills, Sessions and Settings. Every other page has Back.
- Secondary screens (files, run details, settings pages) open as their own routes.

### Auth and error pages

One title and one illustration. Everything else follows the app rules.

## Working with the system

- No theme variable fits? Stop and ask for one. Do not write an arbitrary value.
- To change a value, edit `theme.config.ts` and run `pnpm generate:theme`. It writes the CSS and `tokens.json` (for design tools; the app does not read it).
- To add or change a rule, edit `rules.json` and add its Do and Avoid example to the guide. The guide test fails when a rule has no example or an example has no rule.
- Three checks run in `pnpm lint`. `theme:check` fails when the generated CSS is stale, when `rules.json` is malformed, or when this file uses a word from the "Do not say" column. `design:ratchet` counts the patterns that a rule bans and fails when a count rises. ESLint bans a second icon library.
- Old antd-era names still resolve through the legacy block in `src/styles/globals.css`, which shows the new name for each. Do not add new uses; replace them when you touch the code.
