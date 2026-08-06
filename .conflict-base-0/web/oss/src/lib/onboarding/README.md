# Onboarding System

A scalable, modular onboarding system for guided tours and feature discovery.

## Architecture Overview

```
lib/onboarding/           # Core library
├── types.ts              # Type definitions
├── registry.ts           # Tour registry (singleton)
├── atoms.ts              # Jotai atoms for state
└── index.ts              # Public exports

components/Onboarding/    # React components
├── OnboardingCard.tsx    # Tour card UI
├── OnboardingProvider.tsx # Provider wrapper
├── hooks/
│   └── useOnboardingTour.ts  # Hook for triggering tours
└── tours/                # Tour definitions (co-located or here)
    └── evaluationResultsTour.ts
```

## Quick Start

### 1. Wrap your app with OnboardingProvider

In `_app.tsx`:

```tsx
import {OnboardingProvider} from "@/oss/components/Onboarding"

export default function App({Component, pageProps}: AppProps) {
    return (
        <OnboardingProvider>
            <Component {...pageProps} />
        </OnboardingProvider>
    )
}
```

### 2. Define a tour

Create a tour definition file:

```tsx
// tours/myFeatureTour.ts
import {tourRegistry} from "@/oss/lib/onboarding"
import type {OnboardingTour} from "@/oss/lib/onboarding"

export const MY_FEATURE_TOUR_ID = "my-feature-intro"

const myFeatureTour: OnboardingTour = {
    id: MY_FEATURE_TOUR_ID,
    steps: [
        {
            icon: "👋",
            title: "Welcome!",
            content: "This is the first step of the tour.",
            selector: "#target-element",
            side: "bottom",
            showControls: true,
            showSkip: true,
        },
        {
            icon: "🎯",
            title: "Key Feature",
            content: "Here's an important feature to know about.",
            selector: ".feature-button",
            side: "right",
        },
    ],
}

export function registerMyFeatureTour(): void {
    tourRegistry.register(myFeatureTour)
}
```

### 3. Register and trigger the tour

In your page/component:

```tsx
import {useEffect} from "react"
import {useOnboardingTour} from "@/oss/components/Onboarding"
import {registerMyFeatureTour, MY_FEATURE_TOUR_ID} from "./tours/myFeatureTour"

// Register tour on module load
registerMyFeatureTour()

function MyPage() {
    // Auto-start for new users
    useOnboardingTour({
        tourId: MY_FEATURE_TOUR_ID,
        autoStart: true,
    })

    return <div>...</div>
}
```

## Step Options

Each step supports the following options:

| Option                  | Type                                            | Default    | Description                                        |
| ----------------------- | ----------------------------------------------- | ---------- | -------------------------------------------------- |
| `icon`                  | `string \| ReactNode`                           | -          | Icon shown in the step                             |
| `title`                 | `string`                                        | -          | Step title                                         |
| `content`               | `string \| ReactNode`                           | -          | Step content/description                           |
| `selector`              | `string`                                        | -          | CSS selector for target element (empty = centered) |
| `side`                  | `'top' \| 'bottom' \| 'left' \| 'right' \| ...` | `'bottom'` | Card position relative to target                   |
| `showControls`          | `boolean`                                       | `true`     | Show prev/next buttons                             |
| `showSkip`              | `boolean`                                       | `true`     | Show skip button                                   |
| `selectorRetryAttempts` | `number`                                        | `3`        | Retries for async elements                         |
| `selectorRetryDelay`    | `number`                                        | `200`      | Delay between retries (ms)                         |
| `nextAction`            | `{selector, type?, waitForSelector?, ...}`      | -          | Perform action when Next is clicked                |
| `prevAction`            | `{selector, type?, waitForSelector?, ...}`      | -          | Perform action when Previous is clicked            |
| `waitForSelectorVisible` | `boolean`                                     | `true`     | Require visibility when waiting for selector       |
| `waitForHiddenSelector` | `string`                                       | -          | Wait until selector is hidden/removed              |

### Lifecycle Hooks

```tsx
{
    selector: "#my-element",
    title: "Step with hooks",
    content: "...",

    // Called when step becomes active
    onEnter: () => {
        console.log("Step entered")
    },

    // Called when leaving step
    onExit: () => {
        console.log("Step exited")
    },

    // Called for cleanup when tour ends
    onCleanup: () => {
        console.log("Tour cleanup")
    },

    // Called before advancing (can be async)
    onNext: async () => {
        await saveProgress()
    },

    // Called before moving to previous step (can be async)
    onPrev: async () => {
        await cleanup()
    },

    // Optional panel key for syncing UI state
    panelKey: "testsetPanel",
}
```

## useOnboardingTour Hook

```tsx
const {
    startTour, // Function to manually start the tour
    isActive, // Whether this tour is currently active
    hasBeenSeen, // Whether user has completed this tour
    canAutoStart, // Whether conditions are met for auto-start
} = useOnboardingTour({
    tourId: "my-tour",
    autoStart: true, // Auto-start for new users
    autoStartCondition: true, // Additional condition
})
```

## Atoms

### `isNewUserAtom`

Tracks whether the current user should see onboarding. Set this to `true` after signup:

```tsx
import {useSetAtom} from "jotai"
import {isNewUserAtom} from "@/oss/lib/onboarding"

const setIsNewUser = useSetAtom(isNewUserAtom)
setIsNewUser(true) // After signup
```

### `seenToursAtom`

Tracks which tours have been seen. Automatically updated when tours complete.

### `resetSeenToursAtom`

Reset all seen tours (useful for "replay onboarding" feature):

```tsx
const resetSeenTours = useSetAtom(resetSeenToursAtom)
resetSeenTours()
```

## Tour Registry

Tours are registered in a central registry, allowing:

- Feature modules to register their own tours
- Conditional tours (only shown when condition is met)
- Dynamic tour discovery

```tsx
import {tourRegistry} from "@/oss/lib/onboarding"

// Register with condition
tourRegistry.register(myTour, {
    condition: () => isFeatureEnabled("myFeature"),
})

// Check if tour exists
if (tourRegistry.has("my-tour")) {
    // ...
}

// Get all registered tours
const allTours = tourRegistry.getAll()
```

## Best Practices

### 1. Co-locate tours with features

Put tour definitions near the features they describe:

```
components/
└── MyFeature/
    ├── index.tsx
    ├── MyFeatureComponent.tsx
    └── onboarding/
        └── myFeatureTour.ts
```

### 2. Use meaningful selectors

Prefer `data-testid` or semantic selectors over class names:

```tsx
// Good
selector: "[data-testid='submit-button']"
selector: "#main-navigation"

// Avoid
selector: ".css-1a2b3c" // Generated class names
```

### 3. Handle async elements

For elements that render after data loading:

```tsx
{
    selector: "[data-testid='async-table']",
    selectorRetryAttempts: 10,
    selectorRetryDelay: 200,
}
```

### 4. Keep tours focused

- 3-5 steps per tour is ideal
- Focus on one feature/workflow per tour
- Use multiple tours for different features

### 5. Test your tours

```tsx
// Reset seen tours for testing
import {useSetAtom} from "jotai"
import {resetSeenToursAtom, isNewUserAtom} from "@/oss/lib/onboarding"

function TestButton() {
    const resetTours = useSetAtom(resetSeenToursAtom)
    const setIsNewUser = useSetAtom(isNewUserAtom)

    return (
        <button
            onClick={() => {
                resetTours()
                setIsNewUser(true)
            }}
        >
            Reset Onboarding
        </button>
    )
}
```

## Future Enhancements

Potential improvements for later PRs:

1. **Widget/Checklist** - Floating widget showing onboarding progress
2. **Analytics Integration** - Track tour completion rates
3. **A/B Testing** - Different tours for different user segments
4. **Branching Tours** - Tours that adapt based on user choices
5. **Tour Scheduling** - Show tours at specific times/triggers
