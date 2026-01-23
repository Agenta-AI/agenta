# DrillInView Module

A molecule-first drill-in navigation component for exploring and editing nested entity data. Designed for maximum reusability with customization via ClassNames API, Slots API, and molecule-level configuration.

## Overview

DrillInView enables navigating into nested objects/arrays with breadcrumb navigation, field-by-field editing, and customizable rendering. It integrates with the molecule pattern (Jotai atoms) for state management.

```
┌─────────────────────────────────────────────────────────────────┐
│  MoleculeDrillInView                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ MoleculeDrillInBreadcrumb                                 │  │
│  │  data > attributes > ag.data > messages                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ MoleculeDrillInFieldList                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ MoleculeDrillInFieldItem (role)                     │  │  │
│  │  │   Header: "role" (2 items)        [copy] [expand]   │  │  │
│  │  │   Content: "user"                                   │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ MoleculeDrillInFieldItem (content)                  │  │  │
│  │  │   Header: "content"               [copy] [expand]   │  │  │
│  │  │   Content: "Hello, world!"                          │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

### Component Hierarchy

```
MoleculeDrillInView
├── MoleculeDrillInProvider (Context)
│   ├── MoleculeDrillInBreadcrumb
│   └── MoleculeDrillInFieldList
│       └── MoleculeDrillInFieldItem (per field)
```

### Data Flow

```
┌─────────────┐     ┌────────────────┐     ┌──────────────────┐
│   Molecule  │────▶│  DrillInView   │────▶│   Entity Atoms   │
│   Adapter   │     │   Components   │     │  (data, draft,   │
│             │◀────│                │◀────│   isDirty)       │
└─────────────┘     └────────────────┘     └──────────────────┘
       │                    │
       │                    ▼
       │            ┌────────────────┐
       └───────────▶│   Reducers     │
                    │ (update,       │
                    │  discard)      │
                    └────────────────┘
```

## Quick Start

### Basic Usage

```tsx
import { MoleculeDrillInView, createMoleculeDrillInAdapter } from '@agenta/entity-ui'
import { testcaseMolecule } from '@agenta/entities/testcase'

// Create adapter from molecule
const testcaseAdapter = createMoleculeDrillInAdapter(testcaseMolecule)

// Use in component
function TestcaseDetailView({ testcaseId }: { testcaseId: string }) {
  return (
    <MoleculeDrillInView
      entityId={testcaseId}
      molecule={testcaseAdapter}
    />
  )
}
```

### With Customization

```tsx
<MoleculeDrillInView
  entityId={spanId}
  molecule={traceSpanAdapter}
  // Behavior overrides
  editable={false}
  collapsible={true}
  // Display options
  rootTitle="Span Attributes"
  showBreadcrumb={true}
  showBackArrow={true}
  // Initial path
  initialPath={['attributes', 'ag.data']}
  // Controlled path
  currentPath={path}
  onPathChange={setPath}
  // Custom styling
  classNames={{
    root: 'my-drill-in',
    fieldItem: 'border-b',
  }}
  // Custom slots
  slots={{
    fieldHeader: (props) => <CustomHeader {...props} />,
  }}
/>
```

## API Reference

### Components

#### `MoleculeDrillInView`

Main component that wraps everything in a provider.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `entityId` | `string` | required | The entity ID to display/edit |
| `molecule` | `MoleculeDrillInAdapter` | required | Molecule adapter with drillIn config |
| `initialPath` | `DataPath` | `[]` | Initial path to start at |
| `currentPath` | `DataPath` | - | Controlled path (external state) |
| `onPathChange` | `(path) => void` | - | Callback when path changes |
| `editable` | `boolean` | from molecule | Override editable behavior |
| `collapsible` | `boolean` | from molecule | Override collapsible behavior |
| `rootTitle` | `string` | `'data'` | Title shown at root level |
| `showBreadcrumb` | `boolean` | `true` | Show breadcrumb navigation |
| `showBackArrow` | `boolean` | `true` | Show back arrow in breadcrumb |
| `classNames` | `DrillInClassNames` | - | CSS class overrides |
| `styles` | `DrillInStyles` | - | Inline style overrides |
| `slots` | `DrillInSlots` | - | Custom render slots |

#### `MoleculeDrillInProvider`

Context provider - used internally by MoleculeDrillInView.

#### `MoleculeDrillInBreadcrumb`

Breadcrumb navigation component.

#### `MoleculeDrillInFieldList`

Container that renders the list of fields at current path.

#### `MoleculeDrillInFieldItem`

Individual field renderer with header, content, and actions.

### Hooks

#### `useDrillIn<TEntity>()`

Access drill-in context from any child component.

```tsx
function MyCustomField() {
  const {
    // Entity
    entity,
    entityId,
    isDirty,

    // Navigation
    currentPath,
    navigateInto,
    navigateBack,
    navigateToIndex,
    setPath,

    // Mutations
    updateValue,
    deleteValue,
    addValue,
    discardChanges,

    // Config
    behaviors,
    classNames,
    slots,

    // Collapse
    isCollapsed,
    toggleCollapse,
  } = useDrillIn<MyEntity>()

  return <div>...</div>
}
```

### Adapters

#### `createMoleculeDrillInAdapter(molecule, options?)`

Create an adapter from a molecule.

```typescript
const adapter = createMoleculeDrillInAdapter(testcaseMolecule, {
  display: { valueMode: 'structured' },
  fields: { editable: true, copyable: true },
})
```

#### `createReadOnlyDrillInAdapter(molecule, options?)`

Create a read-only adapter (editable: false).

```typescript
const readOnlyAdapter = createReadOnlyDrillInAdapter(traceSpanMolecule)
```

#### `createEditableDrillInAdapter(molecule, options?)`

Create a fully editable adapter.

```typescript
const editableAdapter = createEditableDrillInAdapter(testcaseMolecule)
```

### Molecule Requirements

For a molecule to work with DrillInView, it must expose:

```typescript
interface AdaptableMolecule<TEntity, TDraft> {
  atoms: {
    data: (id: string) => Atom<TEntity | null>
    draft: (id: string) => Atom<TDraft | null>
    isDirty: (id: string) => Atom<boolean>
  }
  reducers: {
    update: WritableAtom<unknown, [id: string, changes: TDraft], void>
    discard: WritableAtom<unknown, [id: string], void>
  }
  drillIn: {
    getRootData: (entity: TEntity | null) => unknown
    getChangesFromRoot: (entity, rootData, path, value) => TDraft | null
    valueMode?: 'structured' | 'string'
  }
}
```

## Configuration

### DrillInMoleculeConfig

Configuration set at molecule level:

```typescript
interface DrillInMoleculeConfig<TEntity, TDraft> {
  // Required: How to extract navigable data
  getRootData: (entity: TEntity | null) => unknown

  // Required: How to convert path changes back to entity
  getChangesFromRoot: (entity, rootData, path) => TDraft

  // Display options
  display?: {
    valueMode?: 'structured' | 'string'  // How values are stored
    collapsedByDefault?: string[]         // Fields to collapse
    hiddenFields?: string[]               // Fields to hide
    maxDepth?: number                     // Max navigation depth
  }

  // Field behaviors
  fields?: {
    editable?: boolean    // Allow editing (default: false)
    collapsible?: boolean // Show collapse toggle (default: true)
    copyable?: boolean    // Show copy button (default: true)
    deletable?: boolean   // Show delete button (default: false)
    addable?: boolean     // Show add button (default: false)
  }

  // Custom renderers
  renderers?: {
    byType?: Record<string, ComponentType>  // Render by data type
    byPath?: Record<string, ComponentType>  // Render by path
    schemaAware?: boolean                   // Use schema for controls
  }
}
```

## Customization

### ClassNames API

Override CSS classes for any component part:

```tsx
<MoleculeDrillInView
  classNames={{
    root: 'my-drill-in',
    breadcrumb: 'my-breadcrumb',
    breadcrumbItem: 'my-breadcrumb-item',
    fieldList: 'my-field-list',
    fieldItem: 'my-field-item',
    fieldHeader: 'my-field-header',
    fieldHeaderTitle: 'my-field-title',
    fieldHeaderMeta: 'my-field-meta',
    fieldHeaderActions: 'my-field-actions',
    fieldContent: 'my-field-content',
    valueRenderer: 'my-value-renderer',
    empty: 'my-empty-state',
  }}
/>
```

Default class prefix: `ag-drill-in-*`

### Styles API

Apply inline styles to any part:

```tsx
<MoleculeDrillInView
  styles={{
    root: { maxHeight: '500px', overflow: 'auto' },
    fieldItem: { borderBottom: '1px solid #eee' },
  }}
/>
```

### Slots API

Replace default rendering with custom components:

```tsx
<MoleculeDrillInView
  slots={{
    // Custom breadcrumb
    breadcrumb: (props) => (
      <MyBreadcrumb
        path={props.path}
        onNavigate={props.onNavigateToIndex}
      />
    ),

    // Custom field header with mapping controls
    fieldHeader: (props) => (
      <div className="flex items-center gap-2">
        {props.defaultRender()}
        <MappingControls path={props.path} />
      </div>
    ),

    // Custom field content
    fieldContent: (props) => (
      props.canDrillIn
        ? <DrillInButton onClick={props.onDrillIn} />
        : <ValueEditor value={props.field.value} onChange={props.onChange} />
    ),

    // Custom field actions
    fieldActions: (props) => (
      <ActionButtons {...props.actions} />
    ),

    // Custom empty state
    empty: (props) => (
      <EmptyState isRoot={props.isRoot} />
    ),
  }}
/>
```

#### Slot Props

Each slot receives typed props:

```typescript
// Breadcrumb
interface BreadcrumbSlotProps {
  path: DataPath
  rootTitle: string
  onNavigateToIndex: (index: number) => void
  onNavigateBack: () => void
  canGoBack: boolean
}

// Field Header
interface FieldHeaderSlotProps {
  field: PathItem
  path: DataPath
  entity: TEntity | null
  isCollapsed: boolean
  onToggleCollapse: () => void
  canCollapse: boolean
  isDirty: boolean
  childCount?: number
  defaultRender: () => ReactNode
}

// Field Content
interface FieldContentSlotProps {
  field: PathItem
  path: DataPath
  entity: TEntity | null
  editable: boolean
  onChange: (value: unknown) => void
  onDrillIn: () => void
  canDrillIn: boolean
  defaultRender: () => ReactNode
}

// Field Actions
interface FieldActionsSlotProps {
  field: PathItem
  path: DataPath
  entity: TEntity | null
  actions: {
    canCopy: boolean
    canDelete: boolean
    canAdd: boolean
    onCopy: () => void
    onDelete: () => void
    onAdd: () => void
  }
  defaultRender: () => ReactNode
}
```

## Use Cases

### 1. Trace Span Viewer (Read-Only)

```tsx
const spanAdapter = createReadOnlyDrillInAdapter(traceSpanMolecule)

<MoleculeDrillInView
  entityId={spanId}
  molecule={spanAdapter}
  rootTitle="Span Attributes"
  initialPath={['attributes']}
/>
```

### 2. Testcase Editor (Editable)

```tsx
const testcaseAdapter = createEditableDrillInAdapter(testcaseMolecule)

<MoleculeDrillInView
  entityId={testcaseId}
  molecule={testcaseAdapter}
  editable={true}
/>
```

### 3. Schema-Aware Config Editor

```tsx
const configAdapter = createMoleculeDrillInAdapter(configMolecule, {
  fields: { editable: true },
  renderers: { schemaAware: true },
})

<MoleculeDrillInView
  entityId={configId}
  molecule={configAdapter}
  slots={{
    fieldContent: SchemaAwareFieldRenderer,
  }}
/>
```

### 4. Input Mapping Modal

```tsx
<MoleculeDrillInView
  entityId={testcaseId}
  molecule={testcaseAdapter}
  editable={false}
  slots={{
    fieldHeader: (props) => (
      <div className="flex items-center justify-between w-full">
        {props.defaultRender()}
        <MappingSelector
          path={props.path}
          onMap={(targetPath) => handleMapping(props.path, targetPath)}
        />
      </div>
    ),
  }}
/>
```

## Schema Controls

Schema-driven UI controls for rendering form fields based on JSON Schema. These controls use base components from `@agenta/ui` for consistent styling.

### Available Controls

| Control | Description | Base Component |
|---------|-------------|----------------|
| `NumberSliderControl` | Numeric input with slider | `SliderInput`, `LabeledField` |
| `BooleanToggleControl` | Toggle switch for booleans | `LabeledField`, `Switch` |
| `TextInputControl` | Single/multi-line text input | `LabeledField`, `Input` |
| `EnumSelectControl` | Dropdown for enum values | `LabeledField`, `SimpleDropdownSelect` |
| `GroupedChoiceControl` | Grouped select (e.g., model selection) | `LabeledField`, `Select` |
| `PromptSchemaControl` | Full prompt editor with messages | `ChatMessageList` |
| `ResponseFormatControl` | Output format selector | Modal-based |
| `SchemaPropertyRenderer` | Universal field router | Routes to appropriate control |

### Usage

```tsx
import {
  NumberSliderControl,
  BooleanToggleControl,
  TextInputControl,
  EnumSelectControl,
  SchemaPropertyRenderer,
} from '@agenta/entity-ui'

// Individual control
<NumberSliderControl
  schema={temperatureSchema}
  label="Temperature"
  value={0.7}
  onChange={(v) => setTemperature(v)}
/>

// Universal renderer (routes based on schema type)
<SchemaPropertyRenderer
  schema={propertySchema}
  label="My Field"
  value={value}
  onChange={handleChange}
/>
```

### Schema Detection

Controls automatically extract configuration from JSON Schema:

- **NumberSliderControl**: `minimum`, `maximum`, `type: "integer"` for step
- **EnumSelectControl**: `enum` array for options
- **TextInputControl**: `maxLength`, `x-parameters.multiline`
- **GroupedChoiceControl**: `x-parameter: "grouped_choice"`, `choices` object

### Base Components from @agenta/ui

The schema controls use these presentational components:

- **`SliderInput`**: Slider + number input combination
- **`LabeledField`**: Label + tooltip wrapper for form fields
- **`ListItemSkeleton`**: Skeleton loader for lists
- **`SimpleDropdownSelect`**: Compact dropdown button
- **`ChatMessageList`**: Message editor with role dropdowns

## File Structure

```
DrillInView/
├── README.md                      # This file
├── index.ts                       # Public exports
├── types.ts                       # TypeScript interfaces
├── context.ts                     # Context types and defaults
├── classNames.ts                  # ClassNames utilities
├── adapters.ts                    # Adapter factory functions
├── MoleculeDrillInView.tsx        # Main component
├── MoleculeDrillInContext.tsx     # React context provider
├── MoleculeDrillInBreadcrumb.tsx  # Breadcrumb component
├── MoleculeDrillInFieldList.tsx   # Field list container
├── MoleculeDrillInFieldItem.tsx   # Individual field renderer
└── SchemaControls/                # Schema-driven UI controls
    ├── index.ts                   # Control exports
    ├── schemaUtils.ts             # Schema utilities
    ├── NumberSliderControl.tsx    # Numeric slider
    ├── BooleanToggleControl.tsx   # Boolean toggle
    ├── TextInputControl.tsx       # Text input
    ├── EnumSelectControl.tsx      # Enum dropdown
    ├── GroupedChoiceControl.tsx   # Grouped select
    ├── PromptSchemaControl.tsx    # Prompt editor
    ├── ResponseFormatControl.tsx  # Output format
    └── SchemaPropertyRenderer.tsx # Universal router
```

## Integration with Molecules

### Adding DrillIn Support to a Molecule

```typescript
// In your molecule definition
export const myMolecule = {
  atoms: {
    data: (id) => myEntityAtomFamily(id),
    draft: (id) => myDraftAtomFamily(id),
    isDirty: (id) => myIsDirtyAtomFamily(id),
  },
  reducers: {
    update: myUpdateReducer,
    discard: myDiscardReducer,
  },
  drillIn: {
    getRootData: (entity) => entity?.data ?? {},
    getChangesFromRoot: (entity, rootData, path, value) => ({
      data: setValueAtPath(entity?.data ?? {}, path, value),
    }),
    valueMode: 'structured',
  },
}
```

### Example: testcaseMolecule

```typescript
// testcase/state/molecule.ts
export const testcaseMolecule = {
  // ... atoms and reducers
  drillIn: {
    getRootData: (testcase) => testcase ?? {},
    getChangesFromRoot: (testcase, rootData, path, value) => {
      // Return partial changes that will be merged with entity
      return setValueAtPath({}, path, value) as Partial<FlattenedTestcase>
    },
    valueMode: 'structured',
  },
}
```

## Best Practices

1. **Use adapters** - Don't manually construct the adapter object; use the factory functions.

2. **Prefer controlled paths** - For complex UIs, manage path state externally for better integration.

3. **Leverage slots for composition** - Use `defaultRender()` in slots to extend rather than replace.

4. **Define molecule config once** - Set drillIn config at molecule level, override only when needed.

5. **Use classNames for theming** - Prefer classNames over styles for consistent theming.
