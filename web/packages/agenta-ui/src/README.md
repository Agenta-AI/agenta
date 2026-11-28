# @agenta/ui Source Structure

This package holds the shared UI kit: the theme, the shadcn primitives, the parts built on
them, and the larger blocks (tables, editors, app chrome) that the app and the `@agenta/*`
packages share.

## Folder Structure

`src/` has nine folders. They are listed from the bottom layer up. A folder imports only
from the folders above it in this list.

```
src/
├── foundation/      # theme, cn, hooks, CSS
│   ├── design/      # theme.config.ts, rules.json, generated theme CSS
│   ├── theme/       # theme mode
│   ├── styles/      # global CSS files (surfaces, focus, touch, editor themes)
│   ├── hooks/       # shared React hooks
│   └── utils/       # cn, copyToClipboard, layout sizes
├── primitives/      # shadcn registry components (@agenta/ui/ui)
├── composed/        # kit parts built on the primitives (@agenta/ui/composed)
│   ├── controls/    # InputNumber, Segmented, Cascader, pickers, LoadingButton, ...
│   ├── layout/      # RightPane, SplitPane, PageToolbar, Divider, IconTile, ...
│   └── feedback/    # EmptyState, SkeletonRows, tooltips, notification, app-message
├── icons/           # marks and logos (@agenta/ui/icons, llm-icons, agent-icon)
├── layout/          # page frame and scroll (@agenta/ui/layout)
│   ├── panel/       # SplitPanelLayout, FilterRailLayout, PanelSection, ...
│   ├── section/     # SectionCard, ConfigAccordionSection, ...
│   └── page-title/  # the tab title
├── shell/           # app chrome that hosts screens: view-stack, phone, shortcuts, create-menu
├── editor/          # Lexical editors and chat input
│   ├── editor/            # @agenta/ui/editor
│   ├── shared-editor/     # @agenta/ui/shared-editor
│   ├── rich-chat-input/   # @agenta/ui/rich-chat-input
│   ├── chat-message/      # @agenta/ui/chat-message
│   ├── quote-selection/   # @agenta/ui/quote-selection
│   └── MarkdownPreview.tsx
├── data/            # tables, lists, cells, filters, drill-in
│   ├── infinite-virtual-table/  # @agenta/ui/table
│   ├── list-table/              # @agenta/ui/list-table
│   ├── cell-renderers/          # @agenta/ui/cell-renderers
│   ├── filter-menu/, drill-in/, type-chip/
├── patterns/        # domain-neutral blocks (@agenta/ui/components)
│   ├── presentational/          # @agenta/ui/components/presentational
│   ├── selection/               # @agenta/ui/components/selection
│   ├── select-llm-provider/     # @agenta/ui/select-llm-provider
│   └── EntityCard.tsx, DropdownButton.tsx
└── index.ts         # root barrel (kept for old callers; import a subpath instead)
```

Folder names are kebab-case. A module keeps its own inner structure.

A few older imports break the layer order: the table, the cell renderers and the editors
read some `patterns/presentational` parts, the chat message list reads `data/drill-in`, and
`@agenta/ui/utils` re-exports `groupColumns` from the table. Do not add new ones.

## Design Principles

1. **Layers** - A folder imports only from the folders above it in the list.
2. **Colocation** - Related code lives together (e.g., `paginated/` is inside
   `data/infinite-virtual-table/`).
3. **Subpaths** - Each public module has a subpath in `package.json` `exports`. Group subpaths
   (`@agenta/ui/icons`, `@agenta/ui/layout`) hold the small modules of one folder.
4. **Documentation** - Each major module has its own README.

## Module READMEs

- [patterns/README.md](./patterns/README.md): selection and presentational components
- [editor/chat-message/README.md](./editor/chat-message/README.md)
- [editor/editor/README.md](./editor/editor/README.md)
- [editor/shared-editor/README.md](./editor/shared-editor/README.md)
- [data/infinite-virtual-table/README.md](./data/infinite-virtual-table/README.md)
- [icons/llm-icons/README.md](./icons/llm-icons/README.md)
- [patterns/select-llm-provider/README.md](./patterns/select-llm-provider/README.md)
- [foundation/utils/README.md](./foundation/utils/README.md)

## Importing

Import from a subpath, never from the root `@agenta/ui`. The root re-exports the whole kit,
the table and the Lexical editors included.

```typescript
import {Button, Dialog} from "@agenta/ui/ui" // primitives
import {EmptyState, Segmented} from "@agenta/ui/composed" // built on the primitives
import {HeightCollapse, PageLayout, pageContentWidthClass} from "@agenta/ui/layout"
import {GitHubMark} from "@agenta/ui/icons"
import {VersionBadge, SectionCard} from "@agenta/ui/components/presentational"
import {InfiniteVirtualTable} from "@agenta/ui/table"
import {Editor, MarkdownPreview} from "@agenta/ui/editor"
import {cn} from "@agenta/ui/styles"
import {copyToClipboard} from "@agenta/ui/utils"
import {message, modal} from "@agenta/ui/app-message"
```

## Adding New Features

- Table features: add to `data/infinite-virtual-table/` in the right subfolder (`hooks/`,
  `components/`, `helpers/` or `paginated/`).
- A shadcn registry component: add to `primitives/` (`components.json` points there).
- A part built on the primitives: add to `composed/controls/`, `composed/layout/` or
  `composed/feedback/`, and export it from `composed/index.ts`.
- A presentational component: add to `patterns/presentational/` with its own subfolder if
  needed.
- A generic utility: add to `foundation/utils/`.
- A new module: put it in the folder for its layer, give it a README, and add a subpath only
  if no group subpath fits.
