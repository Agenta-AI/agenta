# Components

Reusable UI components organized by domain.

## Structure

```
components/
├── selection/           # Selection UI components
│   ├── SearchInput.tsx      # Search input with clear button
│   ├── ListItem.tsx         # Generic list item
│   ├── VirtualList.tsx      # Virtualized list (@tanstack/react-virtual)
│   ├── LoadMoreButton.tsx   # Pagination button
│   ├── LoadAllButton.tsx    # Load all with progress
│   ├── Breadcrumb.tsx       # Navigation breadcrumb
│   └── index.ts
├── presentational/      # Pure display components
│   ├── version/             # VersionBadge
│   ├── revision/            # RevisionLabel, AuthorLabel
│   ├── entity/              # EntityPathLabel, EntityNameWithVersion
│   ├── section/             # SectionCard, ConfigBlock, SectionLabel
│   ├── metadata/            # MetadataHeader
│   ├── attachments/         # ImageAttachment, FileAttachment, AttachmentGrid
│   ├── field/               # FieldHeader
│   ├── select/              # SimpleDropdownSelect
│   ├── editable/            # EditableText
│   ├── CopyButton.tsx       # Copy to clipboard button
│   └── index.ts
├── modal/               # Modal layout components
│   ├── ModalContent.tsx     # Standardized modal content
│   ├── ModalFooter.tsx      # Standardized modal footer
│   └── index.ts
├── CopyButtonDropdown.tsx   # Copy button with dropdown options
├── EnhancedModal.tsx        # Modal wrapper with lazy rendering
└── index.ts
```

## Quick Start

```tsx
import {
  // Selection
  SearchInput,
  ListItem,
  VirtualList,
  LoadMoreButton,
  Breadcrumb,

  // Presentational
  VersionBadge,
  RevisionLabel,
  EntityPathLabel,
  EntityNameWithVersion,
  CopyButton,
  SectionCard,
  MetadataHeader,
  EditableText,

  // Modal
  EnhancedModal,
  ModalContent,
  ModalFooter,

  // Actions
  CopyButtonDropdown,
} from '@agenta/ui'
```

## Selection Components

Building blocks for list selection UIs with search, virtual scrolling, and pagination.

| Component | Description |
|-----------|-------------|
| `SearchInput` | Search input with clear button and keyboard support |
| `ListItem` | Generic list item with click/navigate variants |
| `VirtualList` | Virtualized list using @tanstack/react-virtual |
| `LoadMoreButton` | Pagination button with count display |
| `LoadAllButton` | Load all pages with progress indicator |
| `Breadcrumb` | Navigation breadcrumb with back button |

## Presentational Components

Pure display components with no data fetching or business logic.

| Component | Description |
|-----------|-------------|
| `VersionBadge` | Version number in "vX" format |
| `RevisionLabel` | Revision details (version, date, message, author) |
| `EntityPathLabel` | Hierarchical paths ("App / Variant / v1") |
| `EntityNameWithVersion` | Entity name with version badge |
| `CopyButton` | Copy to clipboard with visual feedback |
| `SectionCard` | Card container for section content |
| `SectionHeaderRow` | Header row with left/right content |
| `ConfigBlock` | Configuration block with title |
| `MetadataHeader` | Label/value metadata display |
| `EditableText` | Inline editable text |
| `SimpleDropdownSelect` | Simple dropdown using Ant Design |
| `ImageAttachment` | Image preview with remove button |
| `FileAttachment` | File badge with remove button |
| `AttachmentGrid` | Grid layout for attachments |
| `FieldHeader` | Field header with copy/markdown toggle |

## Modal Components

| Component | Description |
|-----------|-------------|
| `EnhancedModal` | Modal wrapper with lazy rendering, auto-height, smart style merging |
| `ModalContent` | Standardized modal content layout with gap options |
| `ModalFooter` | Standardized footer with cancel/confirm buttons |

### Modal Pattern: Content Extraction

For optimal performance, extract modal content into a separate component so data layer logic
only runs when the modal is displayed:

```tsx
// ❌ Bad: Data logic runs even when modal is closed
function MyModal({ open, onClose }) {
  // These hooks run on every render, even when open=false
  const data = useAtomValue(someDataAtom)
  const items = useAtomValue(someListAtom)
  
  return (
    <EnhancedModal open={open} onCancel={onClose}>
      <MyContent data={data} items={items} />
    </EnhancedModal>
  )
}

// ✅ Good: Data logic only runs when modal is open
function MyModal({ open, onClose, ...props }) {
  return (
    <EnhancedModal open={open} onCancel={onClose}>
      <MyModalContent {...props} onClose={onClose} />
    </EnhancedModal>
  )
}

// Content component - only rendered when modal is open
function MyModalContent({ onClose, ...props }) {
  // These hooks only run when the modal is actually visible
  const data = useAtomValue(someDataAtom)
  const items = useAtomValue(someListAtom)
  
  return (
    <div>
      {/* Modal content using data */}
    </div>
  )
}
```

**Benefits:**
- Data subscriptions only active when modal is visible
- No wasted processing when modal is closed
- Cleaner separation of concerns (modal chrome vs content)
- Better performance for pages with many modals

**EnhancedModal features:**
- `lazyRender` (default: true): Content only mounts after first open
- `destroyOnHidden` (default: true): Content unmounts when closed
- Auto-contained height with internal scrolling (default: 90vh max)
- Smart style merging for container/body/footer

## Action Components

| Component | Description |
|-----------|-------------|
| `CopyButtonDropdown` | Copy button with dropdown for multiple copy options |

## Adding New Components

1. **Selection components**: Add to `selection/` folder
2. **Pure display components**: Add to `presentational/` with subfolder if needed
3. **Modal utilities**: Add to `modal/` folder
4. **Standalone components**: Add directly to `components/` folder

Always export from the appropriate `index.ts` file.
