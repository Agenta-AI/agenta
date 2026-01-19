# LLMIcons Module

SVG icons for LLM providers.

## Overview

This module provides React components for LLM provider logos. Each icon is a pure SVG component with no dependencies.

## Quick Start

```tsx
import {LLMIconMap, OpenAi, Anthropic} from '@agenta/entities/ui'

// Using the map
function ProviderIcon({provider}: {provider: string}) {
  const Icon = LLMIconMap[provider]
  if (!Icon) return null
  return <Icon className="w-4 h-4" />
}

// Direct import
function OpenAIIcon() {
  return <OpenAi className="w-6 h-6" />
}
```

## Available Providers

| Provider Name | Component |
|--------------|-----------|
| OpenAI | `OpenAi` |
| Anthropic | `Anthropic` |
| Google Gemini | `Gemini` |
| Google Vertex AI | `Vertex` |
| AWS Bedrock | `Bedrock` |
| AWS SageMaker | `Sagemaker` |
| Azure OpenAI | `Azure` |
| Mistral AI | `Mistral` |
| Cohere | `Cerebus` |
| Together AI | `Together` |
| OpenRouter | `OpenRouter` |
| Groq | `Groq` |
| Perplexity AI | `Perplexity` |
| Anyscale | `AnyScale` |
| DeepInfra | `DeepInfra` |
| Aleph Alpha | `AlephAlpha` |
| Fireworks | `Fireworks` |
| Lepton | `Lepton` |
| Replicate | `Replicate` |
| xAI | `XAI` |

## API Reference

### `LLMIconMap`

A record mapping provider names to icon components.

```typescript
const LLMIconMap: Record<string, React.FC<{className?: string}>>
```

### Icon Props

All icons accept standard SVG props:

```typescript
interface IconProps extends React.SVGProps<SVGSVGElement> {}
```

## File Structure

```
LLMIcons/
├── index.ts           # Exports and IconMap
├── README.md          # This file
└── assets/
    ├── types.d.ts     # IconProps type
    ├── OpenAi.tsx
    ├── Anthropic.tsx
    ├── Gemini.tsx
    └── ... (other providers)
```
