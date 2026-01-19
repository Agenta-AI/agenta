# SelectLLMProvider Module

Base LLM provider selection component with cascading menu support and provider icons.

## Overview

This module provides a base `SelectLLMProviderBase` component that can be used directly or extended in the main application with vault integration and other features.

## Architecture

```
SelectLLMProvider/
├── index.ts                    # Public exports
├── types.ts                    # Type definitions
├── utils.ts                    # Provider icon mapping utilities
├── SelectLLMProviderBase.tsx   # Base component
└── README.md                   # This file
```

## Quick Start

### Basic Usage

```tsx
import {SelectLLMProviderBase} from '@agenta/entities/ui'

const providerOptions = [
  {
    label: 'OpenAI',
    options: [
      {label: 'gpt-4', value: 'gpt-4', metadata: {input: 30, output: 60}},
      {label: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo'},
    ],
  },
  {
    label: 'Anthropic',
    options: [
      {label: 'claude-3-opus', value: 'claude-3-opus'},
      {label: 'claude-3-sonnet', value: 'claude-3-sonnet'},
    ],
  },
]

function ModelSelector() {
  const [model, setModel] = useState<string>()

  return (
    <SelectLLMProviderBase
      value={model}
      onChange={(value) => setModel(value as string)}
      options={providerOptions}
      showSearch
      showGroup
    />
  )
}
```

### With Custom Footer

```tsx
<SelectLLMProviderBase
  value={model}
  onChange={setModel}
  options={options}
  footerContent={
    <Button onClick={handleAddProvider}>
      Add Provider
    </Button>
  }
/>
```

### Extending in OSS with Vault

In the OSS codebase, you can wrap this component with vault integration:

```tsx
import {SelectLLMProviderBase} from '@agenta/entities/ui'
import {useVaultSecret} from '@/oss/hooks/useVaultSecret'

function SelectLLMProvider(props) {
  const {customRowSecrets} = useVaultSecret()

  // Add vault secrets to options
  const extendedOptions = useMemo(() => {
    const vaultOptions = customRowSecrets.map(secret => ({
      label: secret.name,
      options: secret.modelKeys.map(key => ({
        label: key,
        value: key,
      })),
    }))
    return [...vaultOptions, ...(props.options || [])]
  }, [customRowSecrets, props.options])

  return (
    <SelectLLMProviderBase
      {...props}
      options={extendedOptions}
    />
  )
}
```

## API Reference

### `SelectLLMProviderBase`

Base provider select component.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Selected value |
| `onChange` | `(value, option) => void` | - | Change handler |
| `options` | `ProviderGroup[]` | `[]` | Grouped provider options |
| `showGroup` | `boolean` | `false` | Show cascading group menu |
| `showSearch` | `boolean` | `true` | Show search input |
| `footerContent` | `ReactNode` | - | Custom footer content |
| `onSelectValue` | `(value) => void` | - | Additional select handler |

### Types

#### `ProviderGroup`

```typescript
interface ProviderGroup {
  label?: string | null  // Group label (provider name)
  options: ProviderOption[]
}
```

#### `ProviderOption`

```typescript
interface ProviderOption {
  label: string          // Display label
  value: string          // Value when selected
  key?: string           // Unique key
  metadata?: {           // Optional metadata for tooltips
    input?: number       // Input cost per 1M tokens
    output?: number      // Output cost per 1M tokens
  }
}
```

### Utilities

#### `getProviderIcon(key: string)`

Get the icon component for a provider key.

```typescript
const Icon = getProviderIcon('openai')
if (Icon) return <Icon className="w-4 h-4" />
```

#### `getProviderDisplayName(key: string)`

Get the display name for a provider key.

```typescript
getProviderDisplayName('together_ai') // "Together AI"
```

#### `PROVIDER_ICON_MAP`

Map of lowercase provider keys to display names for icon lookup.

```typescript
const PROVIDER_ICON_MAP = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  // ... more providers
}
```

## Features

- **Search**: Filter providers/models by name
- **Cascading Menu**: Grouped view with popover submenus
- **Provider Icons**: Automatic icon lookup from LLMIcons
- **Metadata Tooltips**: Show cost information on hover
- **Extensible**: Add custom footer content and extend with vault integration
