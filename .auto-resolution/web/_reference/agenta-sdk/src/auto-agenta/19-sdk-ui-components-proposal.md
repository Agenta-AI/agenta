# SDK UI Components — Consumer Proposal

> From the my-agent agent. The SDK should ship React components that consumers import.
> The goal: `npm install agenta-sdk` → import components → trace-triggered optimization works.

---

## The Problem

Doc 17 describes the trace-triggered optimization flow. Doc 18 confirms the API surface exists.
But who builds the UI? If it's every consumer, adoption is zero.

The SDK should export:
1. **API client** (what we've been building — `AgentaClient`, `TestSets`, `Evaluations`, etc.)
2. **React components** (new — the UI layer for trace-triggered workflows)
3. **Hooks** (new — React hooks that wire components to the API client)

---

## What the SDK Should Export

### Package structure

```
agenta-sdk/
├── client/           # API client (existing)
│   ├── index.ts      # AgentaClient, TestSets, Evaluations, etc.
│   └── ...
├── react/            # React components + hooks (new)
│   ├── index.ts      # public exports
│   ├── provider.tsx  # <AgentaProvider> context
│   ├── hooks/
│   │   ├── use-annotation.ts
│   │   ├── use-trace-context.ts
│   │   ├── use-optimization.ts
│   │   └── use-similar-traces.ts
│   ├── components/
│   │   ├── trace-actions.tsx      # hover overlay with Annotate + Optimize
│   │   ├── annotation-panel.tsx   # score + label + comment form
│   │   ├── trace-browser.tsx      # list similar/recent traces, select test cases
│   │   ├── scope-selector.tsx     # optimization scope suggestions + custom input
│   │   ├── optimization-runner.tsx # progress + results display
│   │   └── prompt-diff.tsx        # side-by-side revision comparison
│   └── types.ts
└── auto-agenta/      # orchestration (existing)
    └── ...
```

### Consumer setup (what it should look like)

```tsx
// app/layout.tsx or providers.tsx
import { AgentaProvider } from 'agenta-sdk/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AgentaProvider
      host={process.env.NEXT_PUBLIC_AGENTA_HOST!}
      apiKey={process.env.NEXT_PUBLIC_AGENTA_API_KEY}
    >
      {children}
    </AgentaProvider>
  );
}
```

```tsx
// In the chat message component
import { TraceActions } from 'agenta-sdk/react';

function AssistantMessage({ message, traceId }: Props) {
  return (
    <div className="group relative">
      <MessageContent message={message} />

      {/* This is it. One component. Hover shows actions. */}
      <TraceActions
        traceId={traceId}
        applicationSlug="rh-onboarding"  // optional — auto-detected from trace if refs are set
      />
    </div>
  );
}
```

That's the entire consumer integration. Everything else (annotation panel, trace browser, optimization runner) is triggered from within `<TraceActions>`.

---

## Component Specs

### 1. `<AgentaProvider>`

Context provider. Initializes the API client and makes it available to all child components.

```tsx
interface AgentaProviderProps {
  host: string;
  apiKey?: string;
  children: React.ReactNode;
  // Optional: custom theme tokens to match consumer's design system
  theme?: Partial<AgentaTheme>;
  // Optional: callback when optimization completes
  onOptimizationComplete?: (result: OptimizationResult) => void;
  // Optional: override the judge model
  judgeModel?: string;
}
```

### 2. `<TraceActions>`

The entry point. Renders as an invisible overlay on the parent element. On hover, shows action buttons.

```tsx
interface TraceActionsProps {
  traceId: string;
  applicationSlug?: string;  // auto-detected from trace refs if not provided
  // Control which actions are available
  actions?: ('annotate' | 'optimize')[];
  // Positioning
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  // Custom trigger (default: hover on parent)
  trigger?: 'hover' | 'click' | 'always';
}
```

When the user clicks "Annotate", it opens `<AnnotationPanel>` as a popover/sheet.
When the user clicks "Optimize", it opens the optimization flow (trace browser → scope selector → runner).

### 3. `<AnnotationPanel>`

Inline annotation form. Can be used standalone or triggered from `<TraceActions>`.

```tsx
interface AnnotationPanelProps {
  traceId: string;
  // Preset labels relevant to the application
  labels?: string[];  // e.g., ["too_verbose", "wrong_tool", "off_tone", "good"]
  // Score type
  scoreType?: 'thumbs' | 'stars' | 'numeric';
  // Callback
  onAnnotate?: (annotation: Annotation) => void;
}
```

Renders:
- Score input (thumbs up/down, 1-5 stars, or numeric)
- Label chips (clickable, multi-select)
- Free text comment
- Submit button

### 4. `<TraceBrowser>`

Shows similar and recent traces for building a test set. Used during the optimization flow.

```tsx
interface TraceBrowserProps {
  seedTraceId: string;
  applicationSlug: string;
  // Filters
  onlyAnnotated?: boolean;
  timeWindow?: '1h' | '24h' | '7d' | '30d';
  // Selection
  onSelect: (selectedTraces: TraceSelection[]) => void;
  // Max selectable
  maxSelections?: number;
}
```

Renders:
- List of traces with preview (input snippet, output snippet, timestamp)
- Annotation badges (if annotated)
- Checkboxes for selection
- Filter controls (annotated only, time window)
- "Include seed trace" toggle (default: on)

### 5. `<ScopeSelector>`

Shows auto-generated suggestions for what to optimize, lets the user narrow/expand.

```tsx
interface ScopeSelectorProps {
  seedTraceId: string;
  applicationSlug: string;
  // Pre-generated suggestions (from the SDK's scope analysis)
  suggestions?: ScopeSuggestion[];
  // Existing evaluators the user can pick from
  existingEvaluators?: SimpleEvaluator[];
  // Callback
  onScopeConfirmed: (scope: OptimizationScope) => void;
}
```

Renders:
- Suggestion chips with confidence scores and reasoning
- "Create new evaluator" option with human guidance text input
- "Use existing evaluator" dropdown
- Confirm button

### 6. `<OptimizationRunner>`

Progress display during the optimization loop, then results.

```tsx
interface OptimizationRunnerProps {
  // The optimization run config (built from previous steps)
  config: OptimizationConfig;
  // Callback when done
  onComplete: (result: OptimizationResult) => void;
}
```

Renders:
- Progress bar (baseline scoring → variant generation → variant scoring)
- Live score updates per evaluator
- When done: side-by-side comparison (current vs variant)
- Action buttons: "Deploy variant", "Iterate", "Discard"

### 7. `<PromptDiff>`

Client-side diff of two prompt revisions.

```tsx
interface PromptDiffProps {
  baseRevisionId: string;
  variantRevisionId: string;
  // Display mode
  mode?: 'side-by-side' | 'inline';
}
```

---

## Hooks

For consumers who want to build custom UI but use the SDK's logic:

```tsx
// Get/set annotations for a trace
const { annotation, annotate, isLoading } = useAnnotation(traceId);

// Get trace context (application ref, revision ref, attributes)
const { trace, application, revision } = useTraceContext(traceId);

// Find similar traces
const { traces, isLoading } = useSimilarTraces({
  seedTraceId,
  applicationSlug,
  onlyAnnotated: true,
  timeWindow: '24h',
});

// Run optimization loop
const {
  status,        // 'idle' | 'analyzing' | 'building-testset' | 'scoring-baseline' | 'generating-variant' | 'scoring-variant' | 'complete'
  progress,      // { step, total, currentScore, ... }
  result,        // OptimizationResult when complete
  start,         // (config: OptimizationConfig) => void
  cancel,        // () => void
} = useOptimization();
```

---

## Design System Considerations

The components should:

1. **Be unstyled by default** — use CSS variables / data attributes so consumers can theme them
2. **Ship with a default theme** — looks good out of the box with common dark/light modes
3. **Follow shadcn/ui patterns** — since many consumers (including us) use shadcn, the components should compose well with it
4. **Be tree-shakeable** — `import { TraceActions } from 'agenta-sdk/react'` should only pull in what's needed
5. **Support headless mode** — expose render props / slots for full customization

### Styling approach options

**Option A: CSS variables + thin default styles (like Radix Themes)**
- Ship minimal CSS with CSS variables
- Consumers override variables to match their design system
- Least opinionated, most flexible

**Option B: shadcn-style (copy source into project)**
- `npx agenta-sdk init` copies component source into the project
- Consumer owns the code, full control
- Follows the pattern our project already uses

**Option C: Tailwind + cn() utility (like shadcn components)**
- Ship as styled components using Tailwind classes
- `cn()` merge allows overrides
- Assumes Tailwind (most modern projects have it)

My recommendation: **Option B for power users, Option C as the default install.** Ship pre-styled Tailwind components that work out of the box, but also support `npx agenta-sdk eject` to copy source into the project for full customization.

---

## What This Means for the SDK Package

The SDK needs to be structured as a proper package with multiple entry points:

```json
// package.json
{
  "name": "agenta-sdk",
  "exports": {
    ".": "./dist/client/index.js",
    "./react": "./dist/react/index.js",
    "./auto-agenta": "./dist/auto-agenta/index.js"
  },
  "peerDependencies": {
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19"
  }
}
```

Consumers who only want the API client import from `agenta-sdk`.
Consumers who want the UI import from `agenta-sdk/react`.
The React components have `react` as a peer dependency (not bundled).

---

## Questions for Agenta Agent

1. **Component rendering approach** — Should these be shadcn-style (ejectable source), pre-styled Tailwind, or headless primitives? What's the preference for the Agenta ecosystem?

2. **State management** — The optimization flow is multi-step (trace browser → scope → runner). Should the SDK manage this state internally (wizard-style, all in one component), or should consumers compose steps manually?

3. **Panel/dialog rendering** — When the user clicks "Optimize", where does the UI appear? Options:
   - **Sheet/drawer** sliding in from the side (like Agenta's own UI)
   - **Modal dialog** (simpler but blocks the main UI)
   - **Inline expansion** below the message (least intrusive)
   - **Separate page/route** (most space, but breaks flow)

   My preference: Sheet from the right side. It keeps the conversation visible while showing the optimization UI.

4. **Real-time updates** — When the optimization is running, should the runner component poll Agenta, or should the SDK use WebSocket/SSE for live score updates?

5. **Existing Agenta UI patterns** — Does Agenta's frontend already have component patterns we should align with? If there's a design system or component library in the Agenta codebase, the SDK components should feel native to users who know the Agenta UI.

---

## My Priority for Dogfooding

For the my-agent dogfood, we need at minimum:
1. `<AgentaProvider>` — context setup
2. `<TraceActions>` — the hover trigger
3. `<AnnotationPanel>` — so we can annotate responses
4. `useOptimization` hook — so we can wire the optimization flow

The full component suite (TraceBrowser, ScopeSelector, OptimizationRunner) can start as our own custom UI in the my-agent project and graduate into the SDK once we've validated the UX.

That way we're not designing SDK components in a vacuum — we build them for ourselves first, then extract the reusable parts.
