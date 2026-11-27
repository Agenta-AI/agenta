# @agenta/ui

Shared UI components package for the Agenta monorepo.

## Installation

This is an internal workspace package. Add it to your `package.json`:

```json
{
  "dependencies": {
    "@agenta/ui": "workspace:*"
  }
}
```

## Usage

Import from a subpath. The root barrel (`@agenta/ui`) re-exports the whole kit and the table,
so one root import pulls all of it in. The Lexical editors are in `@agenta/editor`.

```typescript
import {Button, Dialog} from "@agenta/ui/ui"
import {CopyTooltip, EmptyState} from "@agenta/ui/composed"
import {HeightCollapse, PageLayout, SectionCard} from "@agenta/ui/layout"
import {VersionBadge, RevisionLabel} from "@agenta/ui/components/presentational"
import {SearchInput, VirtualList} from "@agenta/ui/components/selection"
import {InfiniteVirtualTable, useTableManager} from "@agenta/ui/table"
import {cn} from "@agenta/ui/styles"
import {copyToClipboard} from "@agenta/ui/utils"
```

## Subpath Exports

| Subpath | Folder | Key Exports |
|---------|--------|-------------|
| `@agenta/ui/ui` | `src/primitives` | shadcn primitives (`Button`, `Dialog`, `Sheet`, ...) |
| `@agenta/ui/composed` | `src/composed` | Parts built on the primitives (`EmptyState`, `Segmented`, `SplitPane`, ...) |
| `@agenta/ui/layout` | `src/layout` | `PageLayout`, `PageTitle`, `HeightCollapse`, page width classes, panel layouts, config sections |
| `@agenta/ui/icons` | `src/icons` | `GitHubMark`, `LogoMarks` |
| `@agenta/ui/llm-icons` | `src/icons/llm-icons` | `LLMIconMap`, provider icons |
| `@agenta/ui/agent-icon` | `src/icons/agent-icon` | `AgentIcon`, `AgentIconPicker` |
| `@agenta/ui/components` | `src/patterns` | Selection and presentational components, `EntityCard`, `DropdownButton` |
| `@agenta/ui/components/presentational` | `src/patterns/presentational` | Presentational components |
| `@agenta/ui/table` | `src/data/infinite-virtual-table` | `InfiniteVirtualTable`, paginated store utilities |
| `@agenta/ui/list-table` | `src/data/list-table` | `ListTable` |
| `@agenta/ui/cell-renderers` | `src/data/cell-renderers` | `SmartCellContent`, `JsonCellContent`, ... |
| `@agenta/ui/select-llm-provider` | `src/patterns/select-llm-provider` | `SelectLLMProviderBase` |
| `@agenta/ui/app-message` | `src/composed/feedback` | `AppMessageContext` (default), `message`, `modal`, `notification` |
| `@agenta/ui/styles` | `src/foundation/utils` | `cn`, `layoutSizes` |

`package.json` `exports` lists the full set.

## Documentation

See [src/README.md](./src/README.md) for detailed documentation on:

- The eight folders of `src/` and their layer order
- The module READMEs (table, selection, presentational, utilities)

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```

## Peer Dependencies

- `antd` >= 5.0.0
- `jotai` >= 2.0.0
- `react` >= 18.0.0
- `react-dom` >= 18.0.0
