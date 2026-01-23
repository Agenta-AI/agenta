# UI Utilities for Entity Molecules

This module provides entity-agnostic UI utilities that work with the molecule pattern, enabling reusable drill-in navigation and data editing components.

## Module Structure

```
ui/
├── README.md              # This documentation
├── index.ts               # Public exports
├── DrillInView/           # Drill-in navigation components
│   ├── README.md
│   └── ...
├── modals/                # Entity modals (delete, commit, save)
│   ├── README.md
│   └── ...
├── selection/             # Entity selection system
│   ├── README.md          # Full documentation
│   ├── adapters/          # Entity-specific adapters
│   ├── components/        # EntityPicker, EntitySelectorModal
│   ├── hooks/             # useCascadingMode, useBreadcrumbMode, etc.
│   └── state/             # Jotai atoms for selection state
└── testcase/              # Testcase-specific UI components
    └── ...
```

## Quick Start

```typescript
import {
  // Path utilities
  getValueAtPath,
  setValueAtPath,
  parsePath,
  // DrillIn components
  MoleculeDrillInView,
  useDrillIn,
  // Entity selection
  EntityPicker,
  useEntitySelector,
  // Entity modals
  useEntityDelete,
  EntityCommitModal,
  // Types
  type DrillInMoleculeConfig,
  type AppRevisionSelectionResult,
} from '@agenta/entities/ui'
```

### Entity Selection

```tsx
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entities/ui'

// Cascading dropdowns
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={handleSelect}
/>

// Breadcrumb navigation
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
/>

// List with hover popovers (2-level hierarchies)
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={handleSelect}
  autoSelectLatest
/>
```

For full documentation, see: [selection/README.md](./selection/README.md)

---

## Path Utilities

> **Note:** Path utilities are available from `@agenta/shared` for direct import,
> or from `@agenta/entities/ui` as a convenience re-export.
>
> ```typescript
> // Direct import from @agenta/shared
> import { getValueAtPath, setValueAtPath, parsePath } from '@agenta/shared'
>
> // Or via @agenta/entities/ui (re-export)
> import { getValueAtPath, setValueAtPath, parsePath } from '@agenta/entities/ui'
> ```

Pure functions for navigating and manipulating nested data structures.

### Path Operations

```typescript
import {
  getValueAtPath,
  setValueAtPath,
  deleteValueAtPath,
  hasValueAtPath,
} from '@agenta/entities/ui'

const data = { user: { name: 'Alice', tags: ['admin', 'active'] } }

// Read value at path
getValueAtPath(data, ['user', 'name'])       // 'Alice'
getValueAtPath(data, ['user', 'tags', 0])    // 'admin'

// Set value at path (returns new object, immutable)
setValueAtPath(data, ['user', 'name'], 'Bob')
// { user: { name: 'Bob', tags: [...] } }

// Delete value at path
deleteValueAtPath(data, ['user', 'tags', 0])
// { user: { name: 'Alice', tags: ['active'] } }

// Check if path exists
hasValueAtPath(data, ['user', 'email'])  // false
```

### Path Parsing

```typescript
import { parsePath, pathToString, getParentPath, getLastSegment } from '@agenta/entities/ui'

// Parse string path to segments
parsePath('user.name')        // ['user', 'name']
parsePath('tags[0]')          // ['tags', 0]
parsePath('user.tags[1]')     // ['user', 'tags', 1]

// Convert segments to string
pathToString(['user', 'name'])  // 'user.name'

// Get parent path
getParentPath(['user', 'name'])  // ['user']

// Get last segment
getLastSegment(['user', 'name'])  // 'name'
```

### Inspection Utilities

```typescript
import { isExpandable, getValueType, getChildCount, collectPaths } from '@agenta/entities/ui'

// Check if value can be expanded (object/array)
isExpandable({ name: 'test' })  // true
isExpandable([1, 2, 3])         // true
isExpandable('string')          // false

// Get value type
getValueType({ name: 'test' })  // 'object'
getValueType([1, 2, 3])         // 'array'
getValueType('hello')           // 'string'

// Get child count
getChildCount({ a: 1, b: 2 })   // 2
getChildCount([1, 2, 3])        // 3

// Collect all paths in an object
collectPaths({ user: { name: 'Alice' } })
// [['user'], ['user', 'name']]
```

---

## DrillIn View

The `MoleculeDrillInView` component provides hierarchical data navigation for any entity type.

### Basic Usage

```tsx
import { MoleculeDrillInView } from '@agenta/entities/ui'
import { traceSpanMolecule } from '@agenta/entities/trace'

function SpanEditor({ spanId }: { spanId: string }) {
  return (
    <MoleculeDrillInView
      entityId={spanId}
      molecule={traceSpanMolecule}
      editable={true}
      rootTitle="Span Data"
    />
  )
}
```

### Molecule Configuration

Molecules must include a `drillIn` configuration to work with DrillInView:

```typescript
import { createMolecule, setValueAtPath } from '@agenta/entities/shared'

const myMolecule = createMolecule({
  name: 'myEntity',
  queryAtomFamily,
  draftAtomFamily,
  drillIn: {
    // Extract the data to navigate
    getRootData: (entity) => entity?.data ?? {},

    // Convert path changes back to draft changes
    getChangesFromRoot: (entity, rootData, path) => ({
      data: setValueAtPath(entity?.data ?? {}, path, rootData)
    }),

    // Optional display configuration
    display: {
      valueMode: 'structured',
      hiddenFields: ['__internal', 'metadata.secret'],
      maxDepth: 10,
    },

    // Optional field behaviors
    fields: {
      editable: true,
      collapsible: true,
      copyable: true,
    },
  },
})
```

### Component Props

| Prop | Type | Description |
|------|------|-------------|
| `entityId` | `string` | The entity ID to display/edit |
| `molecule` | `MoleculeDrillInAdapter` | Molecule with drillIn config |
| `initialPath` | `DataPath` | Starting navigation path |
| `currentPath` | `DataPath` | Controlled path (external management) |
| `onPathChange` | `(path) => void` | Path change callback |
| `editable` | `boolean` | Override molecule's editable setting |
| `classNames` | `DrillInClassNames` | Custom CSS classes |
| `styles` | `DrillInStyles` | Inline styles |
| `slots` | `DrillInSlots` | Custom rendering slots |
| `rootTitle` | `string` | Title at root level |
| `showBreadcrumb` | `boolean` | Show breadcrumb navigation |

### Custom Styling (ClassNames API)

The component uses an Ant Design v6-style ClassNames API for customization:

```tsx
import { defaultClassNames, mergeClassNames } from '@agenta/entities/ui'

// Override specific parts
<MoleculeDrillInView
  classNames={{
    root: 'my-drill-in',
    fieldItem: 'my-field-item',
    breadcrumb: 'my-breadcrumb',
  }}
/>

// Merge with defaults
const customClassNames = mergeClassNames(defaultClassNames, {
  fieldItem: 'my-field-item',
})
```

Available class name keys:

| Key | Description |
|-----|-------------|
| `root` | Root container |
| `breadcrumb` | Breadcrumb navigation |
| `breadcrumbItem` | Individual breadcrumb item |
| `fieldList` | Field list container |
| `fieldItem` | Individual field item |
| `fieldHeader` | Field header row |
| `fieldHeaderTitle` | Field name |
| `fieldHeaderMeta` | Field metadata (type, count) |
| `fieldHeaderActions` | Action buttons |
| `fieldContent` | Field value/editor |
| `empty` | Empty state |

### Slots API

Override specific parts of the component:

```tsx
<MoleculeDrillInView
  slots={{
    // Custom field header with additional controls
    fieldHeader: (props) => (
      <div className="custom-header">
        {props.defaultRender()}
        <MappingToggle path={props.path} />
      </div>
    ),

    // Custom empty state
    empty: ({ isRoot }) => (
      <div className="empty">
        {isRoot ? 'No data available' : 'This field is empty'}
      </div>
    ),
  }}
/>
```

Available slots:

| Slot | Props | Description |
|------|-------|-------------|
| `breadcrumb` | `BreadcrumbSlotProps` | Custom breadcrumb |
| `fieldHeader` | `FieldHeaderSlotProps` | Field name/meta row |
| `fieldContent` | `FieldContentSlotProps` | Field value display |
| `fieldActions` | `FieldActionsSlotProps` | Action buttons |
| `empty` | `EmptySlotProps` | Empty state |

### Using the Context Hook

Access drill-in state in child components:

```tsx
import { useDrillIn, MoleculeDrillInProvider } from '@agenta/entities/ui'

function CustomField() {
  const { entity, currentPath, updateValue, navigateTo } = useDrillIn()

  return (
    <button onClick={() => navigateTo(['nested', 'path'])}>
      Go to nested
    </button>
  )
}
```

---

## Types Reference

### DrillInMoleculeConfig

Configuration for molecule-level drillIn behavior:

```typescript
interface DrillInMoleculeConfig<TEntity, TDraft> {
  getRootData: (entity: TEntity | null) => unknown
  getChangesFromRoot: (entity: TEntity | null, rootData: unknown, path: DataPath) => TDraft
  display?: DrillInDisplayConfig
  fields?: DrillInFieldBehaviors
  renderers?: DrillInRenderers<TEntity>
}
```

### DrillInDisplayConfig

```typescript
interface DrillInDisplayConfig {
  valueMode?: 'structured' | 'string'
  collapsedByDefault?: string[]
  hiddenFields?: string[]
  maxDepth?: number
}
```

### DrillInFieldBehaviors

```typescript
interface DrillInFieldBehaviors {
  editable?: boolean
  collapsible?: boolean
  copyable?: boolean
  deletable?: boolean
  addable?: boolean
}
```

### DataPath

```typescript
type PathSegment = string | number
type DataPath = PathSegment[]

// Examples:
['user', 'name']       // user.name
['items', 0, 'title']  // items[0].title
['nested', 'deep', 'value']  // nested.deep.value
```

### PathItem

Represents a field in the drill-in navigation:

```typescript
interface PathItem {
  key: string | number
  value: unknown
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined'
  expandable: boolean
  childCount?: number
}
```

---

## Utilities Reference

### ClassNames Utilities

```typescript
import {
  drillInPrefixCls,           // 'ag-drill-in'
  defaultClassNames,          // Default class name mapping
  defaultStateClassNames,     // State modifiers (collapsed, expanded, etc.)
  mergeClassNames,            // Merge custom with defaults
  buildClassName,             // Build class string from parts
  createClassNameBuilder,     // Create a builder for component
  useDrillInClassNames,       // React hook for class names
} from '@agenta/entities/ui'
```

### Default Field Behaviors

```typescript
import { defaultFieldBehaviors } from '@agenta/entities/ui'

// {
//   editable: false,
//   collapsible: true,
//   copyable: true,
//   deletable: false,
//   addable: false,
// }
```
