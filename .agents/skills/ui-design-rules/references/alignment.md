# Alignment examples

The source screenshots are not in the repo. Each example names the anchor, the line, and
what follows it. To check a screen, draw a vertical line from the anchor to the bottom of
the view and see what touches it.

## Bad: home screen, components drift off the line

Screen: the home view with the greeting "What should we work on?", the composer, the
"New agent" picker, the "Your agents / Templates" tabs, and the agents list.

- The anchor is the hero: the title or the composer.
- Draw a line from either one. The components below it, and their text, do not sit on
  that line.

The view has no line that its parts follow.

**Fix:** pick one anchor and make the downstream components and their text follow its
line.

## Good: Integrations page, left edge

Screen: "Integrations" title, its subtitle, the search input, the category chips
("All", "Developer Tools", ...), the "Developer Tools 460" section heading, and the
integration list.

- Anchor: the page title.
- Line: the title's left edge.
- On the line: the subtitle text, the search input's left edge, the first chip, the
  section heading, and the left edge of every row's logo tile.

## Good: Skills list, left edge

Screen: "Skills" title and subtitle, the search input with "Filter" and "Show archived",
the table header ("Name", "Used by"), the "This project" group, and the skill rows.

- Anchor: the page title.
- Line: the title's left edge.
- On the line: the subtitle, the search input, the table's checkbox column, the group
  label, and the row icons.

## Good: skill detail page, left edge

Screen: "Skills" back link, the "Slack Gif Creator" title, the source and usage line,
the "Description" heading, and the description box.

- Anchor: the page title.
- Line: the title's left edge.
- On the line: the back link, the source line, the "Description" heading, and the left
  border of the description box.

## Good: sidebar, center line

Screen: the sidebar with the "Default" workspace avatar at the top, the nav items
(Home, Agents, Skills, Automations, More, Sessions), and Credits and Settings at the
bottom.

- Anchor: the workspace avatar.
- Line: the avatar's **center**, not its left edge.
- On the line: the center of every nav icon, from Home down to Settings.

If the icons followed the avatar's left edge, the avatar would look off.
