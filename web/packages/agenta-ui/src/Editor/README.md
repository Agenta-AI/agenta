# Editor Module

A comprehensive rich text and code editor built on [Lexical](https://lexical.dev/) with support for JSON/YAML syntax highlighting, markdown editing, token/variable highlighting, form view for structured data, and diff visualization.

## Overview

The Editor provides a flexible editing experience that adapts to different content types:

- **Code Mode**: JSON/YAML syntax highlighting with validation and error indicators
- **Rich Text Mode**: Full markdown support with toolbar
- **Form View**: Structured editing for JSON objects/arrays
- **Token Mode**: Variable/template highlighting (e.g., `{{variable}}`)
- **Diff View**: Side-by-side comparison of changes

```
┌─────────────────────────────────────────────────────────────────┐
│  Editor                                                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ [Toolbar: Bold | Italic | List | Code | ...]              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1 │ {                                                     │  │
│  │ 2 │   "name": "example",                                  │  │
│  │ 3 │   "value": {{token}}                                  │  │
│  │ 4 │ }                                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

### Component Hierarchy

```
Editor
├── LexicalComposer (Lexical context)
│   └── EditorPlugins
│       ├── RichTextPlugin (contenteditable)
│       ├── HistoryPlugin (undo/redo)
│       ├── ToolbarPlugin (optional)
│       ├── CodeEditorPlugin (for codeOnly mode)
│       │   ├── SyntaxHighlightPlugin
│       │   ├── RealTimeValidationPlugin
│       │   ├── PropertyClickPlugin
│       │   └── ...
│       ├── TokenPlugin (for enableTokens mode)
│       ├── MarkdownPlugin (for rich text mode)
│       └── ...
```

### Data Flow

```
┌─────────────┐     ┌────────────────┐     ┌──────────────────┐
│   Props     │────▶│    Editor      │────▶│   Lexical State  │
│ (value,     │     │   Components   │     │   (EditorState)  │
│  onChange)  │◀────│                │◀────│                  │
└─────────────┘     └────────────────┘     └──────────────────┘
       │                    │
       │                    ▼
       │            ┌────────────────┐
       └───────────▶│   onChange     │
                    │   callback     │
                    └────────────────┘
```

## Quick Start

### Basic Usage

```tsx
import {Editor} from '@agenta/entities/editor'

function MyEditor() {
  const [value, setValue] = useState('{"key": "value"}')

  return (
    <Editor
      initialValue={value}
      language="json"
      codeOnly
      onChange={({textContent}) => setValue(textContent)}
    />
  )
}
```

### Rich Text Mode

```tsx
import {Editor} from '@agenta/entities/editor'

<Editor
  initialValue="# Hello World"
  showToolbar
  onChange={({textContent}) => console.log(textContent)}
/>
```

### With Token Support

```tsx
import {Editor} from '@agenta/entities/editor'

<Editor
  initialValue="Hello, {{name}}! Welcome to {{platform}}."
  enableTokens
  tokens={['name', 'platform', 'date']}
  templateFormat="curly"
  onChange={({textContent, tokens}) => {
    console.log('Text:', textContent)
    console.log('Tokens used:', tokens)
  }}
/>
```

### Diff View

```tsx
import {DiffView} from '@agenta/entities/editor'

<DiffView
  language="json"
  original='{"version": "1.0.0"}'
  modified='{"version": "2.0.0"}'
/>
```

## API Reference

### Components

#### `Editor`

Main editor component.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | auto-generated | Unique identifier for the editor instance |
| `initialValue` | `string` | `""` | Initial content |
| `value` | `string` | - | Controlled value (for undo/redo support) |
| `onChange` | `(result) => void` | - | Callback with `{textContent, tokens?, value?}` |
| `placeholder` | `string` | `"Enter some text..."` | Placeholder text |
| `language` | `"json" \| "yaml" \| "code"` | - | Code highlighting language |
| `codeOnly` | `boolean` | `false` | Enable code-only mode (no rich text) |
| `singleLine` | `boolean` | `false` | Restrict to single line |
| `showToolbar` | `boolean` | `true` | Show formatting toolbar |
| `enableTokens` | `boolean` | `false` | Enable token/variable support |
| `tokens` | `string[]` | `[]` | Available token names for autocomplete |
| `templateFormat` | `"curly" \| "fstring" \| "jinja2"` | - | Token syntax format |
| `autoFocus` | `boolean` | `false` | Focus on mount |
| `disabled` | `boolean` | `false` | Disable editing |
| `debug` | `boolean` | `false` | Show debug panel |
| `enableResize` | `boolean` | `true` | Allow resize handle |
| `boundWidth` | `boolean` | `true` | Bound width to container |
| `boundHeight` | `boolean` | - | Bound height to container |
| `showBorder` | `boolean` | `true` | Show border around editor |
| `showLineNumbers` | `boolean` | `true` | Show line numbers in code mode |
| `validationSchema` | `unknown` | - | JSON Schema for validation |
| `onPropertyClick` | `(path) => void` | - | Callback when Cmd+clicking a JSON property |
| `disableLongText` | `boolean` | `false` | Disable long text truncation |
| `additionalCodePlugins` | `ReactNode[]` | `[]` | Additional plugins for code mode |

#### `DiffView`

Component for comparing two values.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `original` | `string \| object` | required | Original value |
| `modified` | `string \| object` | required | Modified value |
| `language` | `"json" \| "yaml"` | auto-detect | Content language |
| `title` | `string` | - | Optional title |
| `mode` | `"split" \| "unified"` | `"split"` | Diff display mode |

### Hooks

#### `useEditorConfig`

Get Lexical editor configuration.

```tsx
const config = useEditorConfig({
  codeOnly: true,
  language: 'json',
  enableTokens: false,
})
```

#### `useEditorResize`

Handle editor resizing.

```tsx
const {setContainerElm, dimensions} = useEditorResize({
  enableResize: true,
  boundWidth: true,
})
```

### State Atoms

#### `editorStateAtom`

Global editor state.

#### `markdownViewAtom(id: string)`

Per-editor markdown view toggle state.

```tsx
import {markdownViewAtom} from '@agenta/entities/editor'

const isMarkdownView = useAtomValue(markdownViewAtom(editorId))
```

### Commands

#### `TOGGLE_FORM_VIEW`

Toggle between code and form view.

```tsx
import {useLexicalComposerContext} from '@agenta/entities/editor'

const [editor] = useLexicalComposerContext()
editor.dispatchCommand(TOGGLE_FORM_VIEW, undefined)
```

#### `TOGGLE_MARKDOWN_VIEW`

Toggle markdown preview.

#### `ON_CHANGE_LANGUAGE`

Change syntax highlighting language.

```tsx
editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: 'yaml'})
```

#### `DRILL_IN_TO_PATH`

Navigate to a specific path in form view.

```tsx
editor.dispatchCommand(DRILL_IN_TO_PATH, {path: 'data.items[0]'})
```

### Utilities

#### `safeJson5Parse(input: string)`

Parse JSON with JSON5 fallback and partial JSON recovery.

```tsx
import {safeJson5Parse} from '@agenta/entities/editor'

const parsed = safeJson5Parse('{"key": value}') // handles unquoted values
```

#### `tryParsePartialJson(input: string)`

Attempt to parse incomplete/partial JSON.

#### `createHighlightedNodes(text, language, disableLongText?)`

Create syntax-highlighted Lexical nodes from text.

## File Structure

```
Editor/
├── README.md                    # This file
├── index.ts                     # Public exports
├── Editor.tsx                   # Main editor component
├── DiffView.tsx                 # Diff visualization
├── types.d.ts                   # TypeScript interfaces
├── assets/
│   └── theme.ts                 # Editor theme styles
├── commands/
│   └── InitialContentCommand.ts # Content initialization
├── hooks/
│   ├── useEditorConfig/         # Lexical configuration
│   ├── useEditorInvariant.ts    # Props validation
│   └── useEditorResize.ts       # Resize handling
├── form/
│   ├── FormView.tsx             # Form editing mode
│   └── nodes/                   # Form node renderers
├── plugins/
│   ├── index.tsx                # Plugin composition
│   ├── code/                    # Code editing plugins
│   │   ├── index.tsx
│   │   ├── nodes/               # Custom Lexical nodes
│   │   ├── plugins/             # Sub-plugins
│   │   └── utils/               # Utilities
│   ├── token/                   # Token/variable plugins
│   ├── markdown/                # Markdown plugins
│   ├── toolbar/                 # Toolbar plugin
│   ├── singleline/              # Single-line restriction
│   └── debug/                   # Debug panel
├── state/
│   ├── index.tsx                # State provider
│   ├── types.d.ts
│   └── assets/
│       └── atoms.ts             # Jotai atoms
└── utils/
    └── ...                      # Shared utilities
```

## Integration Examples

### With DrillInView

The Editor integrates with DrillInView for navigating into nested JSON:

```tsx
import {Editor, DRILL_IN_TO_PATH} from '@agenta/entities/editor'

<Editor
  codeOnly
  language="json"
  initialValue={data}
  onPropertyClick={(path) => {
    // Handle navigation to nested path
    setCurrentPath(path.split('.'))
  }}
/>
```

### With Validation Schema

```tsx
const schema = {
  type: 'object',
  properties: {
    name: {type: 'string'},
    age: {type: 'number'},
  },
  required: ['name'],
}

<Editor
  codeOnly
  language="json"
  validationSchema={schema}
  initialValue='{"name": "John"}'
/>
```

### Controlled Value (Undo/Redo)

```tsx
const [value, setValue] = useState('{}')
const [history, setHistory] = useState<string[]>([])

<Editor
  codeOnly
  language="json"
  value={value} // Controlled - editor updates when this changes
  onChange={({textContent}) => {
    setHistory([...history, value])
    setValue(textContent)
  }}
/>

// Undo
const handleUndo = () => {
  if (history.length > 0) {
    setValue(history[history.length - 1])
    setHistory(history.slice(0, -1))
  }
}
```

## Peer Dependencies

```json
{
  "@lexical/code": ">=0.38.0",
  "@lexical/hashtag": ">=0.38.0",
  "@lexical/link": ">=0.38.0",
  "@lexical/list": ">=0.38.0",
  "@lexical/markdown": ">=0.38.0",
  "@lexical/react": ">=0.38.0",
  "@lexical/rich-text": ">=0.38.0",
  "@lexical/table": ">=0.38.0",
  "@lexical/utils": ">=0.38.0",
  "lexical": ">=0.38.0",
  "js-yaml": ">=4.0.0",
  "prismjs": ">=1.29.0",
  "ajv": ">=8.0.0"
}
```

## Known Issues

The following type issues exist in the Editor module (inherited from OSS codebase):

1. **Antd Dropdown API** - Uses deprecated `overlay` prop instead of `menu`. Needs migration to antd v5 API.
2. **Language type narrowing** - Some places need explicit type narrowing for language unions.
3. **Error handling** - Some catch blocks use `unknown` without proper type narrowing.

These issues don't affect runtime behavior but will cause TypeScript errors in strict mode. They should be fixed in the original OSS codebase first.

## Best Practices

1. **Use controlled value for undo/redo** - Pass `value` prop when you need external state management.

2. **Prefer codeOnly for structured data** - Use `codeOnly={true}` with `language="json"` for better validation.

3. **Enable tokens for templates** - Use `enableTokens` with `templateFormat` for prompt templates.

4. **Use onPropertyClick for navigation** - Implement drill-in navigation by handling property clicks.

5. **Set appropriate dimensions** - Use `dimensions` prop for fixed-size editors.
