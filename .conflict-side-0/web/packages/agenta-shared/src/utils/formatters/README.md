# Formatting Utilities

A comprehensive set of number formatting utilities for displaying values in the UI.

## Overview

The formatters module provides:

- **Preset formatters** for common use cases (numbers, currency, latency, tokens, percentages)
- **`formatSignificant`** for displaying values with 3 significant figures
- **`createFormatter`** factory for building custom formatters

All formatters handle `null`, `undefined`, and `NaN` gracefully, returning a fallback string (`"-"` by default).

## Installation

```typescript
import {
  formatNumber,
  formatCurrency,
  formatLatency,
  formatSignificant,
  createFormatter,
} from '@agenta/shared'
```

## Preset Formatters

### `formatNumber(value)`

Formats with locale-aware thousand separators and 2 decimal places.

```typescript
formatNumber(1234.567)  // "1,234.57"
formatNumber(null)      // "-"
```

### `formatCompact(value)`

Formats in compact notation (1K, 1M, 1B).

```typescript
formatCompact(1234)      // "1.2K"
formatCompact(1500000)   // "1.5M"
```

### `formatCurrency(value)`

Formats as USD currency with up to 6 decimal places.

```typescript
formatCurrency(1234.56)   // "$1,234.56"
formatCurrency(0.00123)   // "$0.001230"
```

### `formatLatency(value)`

Formats duration in seconds to human-readable latency. Automatically selects the appropriate unit (μs, ms, s).

```typescript
formatLatency(0.0001)   // "100μs"
formatLatency(0.5)      // "500ms"
formatLatency(2.5)      // "2.5s"
```

### `formatTokens(value)`

Formats token counts with compact notation for large numbers.

```typescript
formatTokens(500)       // "500"
formatTokens(1500)      // "1.5K"
formatTokens(1500000)   // "1.5M"
```

### `formatPercent(value)`

Formats a decimal (0-1) as a percentage.

```typescript
formatPercent(0.856)    // "85.60%"
formatPercent(1)        // "100%"
formatPercent(0.001)    // "0.10%"
```

### `formatSignificant(value)`

Formats with 3 significant figures. Uses scientific notation for very large or very small numbers.

```typescript
formatSignificant(1234)      // "1230"
formatSignificant(0.00456)   // "0.00456"
formatSignificant(1.5e12)    // "1.50e+12"
formatSignificant(0)         // "0"
```

## Custom Formatters

### `createFormatter(options)`

Creates a custom formatter function with the specified options.

#### Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `decimals` | `number` | `2` | Number of decimal places |
| `significantFigures` | `number` | - | Use significant figures instead of fixed decimals |
| `prefix` | `string` | `""` | Prefix to prepend (e.g., "$") |
| `suffix` | `string` | `""` | Suffix to append (e.g., "%", "ms") |
| `multiplier` | `number` | `1` | Multiplier to apply before formatting |
| `fallback` | `string` | `"-"` | Fallback for null/undefined/NaN |
| `compact` | `boolean` | `false` | Use compact notation (1K, 1M) |
| `locale` | `boolean` | `false` | Use locale-aware formatting |

#### Examples

```typescript
// Score formatter (0-1 to percentage)
const formatScore = createFormatter({
  multiplier: 100,
  suffix: '%',
  decimals: 1,
})
formatScore(0.856)  // "85.6%"

// Cost formatter
const formatCost = createFormatter({
  prefix: '$',
  decimals: 4,
})
formatCost(0.0123)  // "$0.0123"

// Duration in milliseconds
const formatMs = createFormatter({
  multiplier: 1000,
  suffix: 'ms',
  decimals: 0,
})
formatMs(0.5)  // "500ms"

// Compact with prefix
const formatViews = createFormatter({
  compact: true,
  suffix: ' views',
})
formatViews(1500000)  // "1.5M views"
```

## Migration from OSS

If you're migrating from the OSS formatters:

| Old (OSS) | New (@agenta/shared) |
|-----------|---------------------|
| `format3Sig(value)` | `formatSignificant(value)` |
| `formatCompactNumber(value)` | `formatCompact(value)` |
| `formatTokenUsage(value)` | `formatTokens(value)` |
| Custom `METRIC_FORMATTERS` config | `createFormatter(options)` |

## Types

```typescript
interface FormatterOptions {
  decimals?: number
  significantFigures?: number
  prefix?: string
  suffix?: string
  multiplier?: number
  fallback?: string
  compact?: boolean
  locale?: boolean
}

type Formatter = (value: number | string | undefined | null) => string
```
