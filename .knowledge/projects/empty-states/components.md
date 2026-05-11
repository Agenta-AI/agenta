# Component API: EmptyState

## Overview

A reusable empty state component for pages/sections with no data. Displays a title, description, CTAs, and an optional video/image preview.

## Location

```
web/oss/src/components/EmptyState/
├── EmptyState.tsx
└── index.ts
```

## Props

```typescript
interface EmptyStateProps {
  /** URL to video (mp4/webm) or image (gif/png/jpg) */
  previewUrl: string
  
  /** Alt text for image, or aria-label for video */
  previewAlt: string
  
  /** Whether preview is a video. Default: auto-detect from URL extension */
  isVideo?: boolean
  
  /** Main heading */
  title: string
  
  /** Supporting description (1-2 sentences) */
  description: string
  
  /** Primary call-to-action */
  primaryCta: {
    label: string
    onClick: () => void
    icon?: ReactNode
  }
  
  /** Optional secondary call-to-action (link) */
  secondaryCta?: {
    label: string
    href: string
  }
  
  /** Centers the component vertically within its parent. Default: false */
  centerVertically?: boolean
}
```

## Basic Usage

```tsx
import EmptyState from "@/oss/components/EmptyState"
import {Play} from "@phosphor-icons/react"

const MyEmptyState = () => (
  <EmptyState
    previewUrl="/assets/my-feature.mp4"
    previewAlt="Feature demonstration"
    title="Get Started with My Feature"
    description="Brief explanation of what this feature does and why users should use it."
    primaryCta={{
      label: "Create Something",
      onClick: () => openModal(),
      icon: <Play size={16} />,
    }}
    secondaryCta={{
      label: "Learn More",
      href: "https://docs.agenta.ai/my-feature",
    }}
    centerVertically
  />
)
```

## Page-Specific Wrappers

Create thin wrapper components for each page to encapsulate copy and behavior:

```tsx
// web/oss/src/components/pages/evaluations/autoEvaluation/EmptyStateEvaluation/EmptyStateEvaluation.tsx

import {Play} from "@phosphor-icons/react"
import EmptyState from "@/oss/components/EmptyState"

const EmptyStateEvaluation = ({onRunEvaluation}: {onRunEvaluation: () => void}) => {
  return (
    <EmptyState
      previewUrl="/assets/eval.mp4"
      previewAlt="Evaluation workflow demonstration"
      title="Get Started with Evaluations"
      description="Compare prompt versions, catch regressions, and measure quality automatically."
      primaryCta={{
        label: "Run Evaluation",
        onClick: onRunEvaluation,
        icon: <Play size={16} />,
      }}
      secondaryCta={{
        label: "Learn More",
        href: "https://docs.agenta.ai/evaluation/overview",
      }}
      centerVertically
    />
  )
}

export default EmptyStateEvaluation
```

## Integration with Tables

To replace a table with empty state when no data:

```tsx
// In your table component

const isEmptyState = useMemo(
  () =>
    pagination.paginationInfo.totalCount === 0 &&
    !pagination.paginationInfo.isFetching &&
    someCondition, // e.g., evaluationKind === "auto"
  [pagination.paginationInfo.isFetching, pagination.paginationInfo.totalCount, someCondition],
)

if (isEmptyState) {
  return (
    <div className={clsx("flex flex-col", autoHeight ? "h-full min-h-0" : "min-h-0", className)}>
      <MyEmptyState onAction={() => setModalOpen(true)} />
      
      {/* Still render modals so CTA works */}
      <MyModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

// Otherwise render normal table...
```

## Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      max-w-4xl container                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │              Title (text-2xl, font-bold)              │  │
│  │                                                       │  │
│  │         Description (text-base, text-muted)           │  │
│  │                                                       │  │
│  │    ┌─────────────────┐   ┌─────────────────┐          │  │
│  │    │  Primary CTA    │   │  Secondary CTA  │          │  │
│  │    │  (size="large") │   │  (size="large") │          │  │
│  │    └─────────────────┘   └─────────────────┘          │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │                                                 │  │  │
│  │  │              Video Preview                      │  │  │
│  │  │              (max-w-3xl)                        │  │  │
│  │  │                                                 │  │  │
│  │  │              autoplay, loop, muted              │  │  │
│  │  │                                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Styling Notes

- Container: `max-w-4xl` (~896px), `px-8 py-8`
- Video container: `max-w-3xl` (~768px), `rounded-lg border`
- Title: `text-2xl font-bold`
- Description: `text-base text-muted`, `max-w-2xl`
- Buttons: `size="large"`, `px-8` for wider appearance
- Video: `autoPlay muted loop playsInline controls controlsList="nodownload"`

## Future Enhancements

1. **Banner variant**: Horizontal layout for pages with default items
2. **Feature cards**: Optional grid of feature explanations below video
3. **Loading state**: Skeleton while video loads
4. **Error state**: Fallback if video fails to load
