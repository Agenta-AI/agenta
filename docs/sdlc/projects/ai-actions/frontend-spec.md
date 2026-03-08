# Frontend Specification: Refine AI Feature

This document specifies the frontend implementation for the Refine Prompt AI feature.

## Table of Contents

1. [Overview](#overview)
2. [Design Reference](#design-reference)
3. [Interaction Flows](#interaction-flows)
4. [Component Architecture](#component-architecture)
5. [State Management](#state-management)
6. [API Integration](#api-integration)
7. [Implementation Plan](#implementation-plan)

---

## Overview

The Refine AI feature allows users to improve their prompts by providing instructions (guidelines) to an AI. Users provide refinement instructions, and the AI returns a refined prompt along with an explanation of changes.

### Key Insight: Not a Chat

**Important**: This is NOT a chat conversation under the hood. The API takes:
- `prompt_template_json` - The prompt to refine
- `guidelines` - User's refinement instructions
- `context` - Optional additional context

And returns:
- `messages` - The refined messages array
- `summary` - Short description of what changed

The UI presents this as a chat-like interface for UX, but the state should model it as **refinement iterations**, not chat messages.

### Key Features

1. **Magic Wand Icon** - Added to the Prompt collapse header to trigger the Refine modal
2. **Two-Panel Modal** - Left panel for refinement instructions, right panel for refined prompt preview
3. **Diff View Toggle** - Compare original vs refined prompt as JSON diff
4. **Iterative Refinement** - Each subsequent refinement uses the previous result as starting point
5. **Editable Preview** - Users can edit the refined prompt before applying

---

## Design Reference

### 1. Prompt Collapse Header (Magic Wand Icon)

**Location**: `PlaygroundVariantConfigPromptCollapseHeader.tsx`

**Design Elements**:
- Magic wand icon (MagicWand from @phosphor-icons/react)
- Positioned to the left of the LLM model selector
- Icon-only button, small size (24x24px)
- On hover: subtle background highlight
- On click: Opens the Refine Prompt modal

**Layout**:
```
[Caret] [Prompt Label]                    [Magic Wand] [LLM Model Selector v]
```

### 2. Refine Prompt Modal

**Dimensions**: ~900px wide, 90vh max height (two-column layout)

#### Left Panel: Instructions

**Header**:
- Title: "Instructions"
- Subtitle: "Chat with an LLM agent to improve your prompt"

**Content Area** (using Ant Design X Bubble):
- Uses `@ant-design/x` `Bubble` and `Bubble.List` components
- User guidelines: `placement="end"` (right-aligned), gray background
- AI explanations: `placement="start"` (left-aligned), no background
- Font: IBM Plex Mono, 12px (monospace for consistency with code)
- Auto-scrolls to latest message

**Footer**:
- Input field with placeholder "Enter refinement instructions..."
- Send button (PaperPlaneTilt icon, primary filled)
- Input spans full width minus button

#### Right Panel: Refined Prompt Preview

**Header**:
- Title: "Refine prompt"
- Diff toggle: Switch component with "Diff" label
- Close button (X icon)

**Content Area** (Two Modes):

**Normal Mode (Diff OFF)**:
- Displays editable message components (same as Playground message editor)
- Each message shows: Role dropdown (System/User/Assistant), message content
- Messages are editable before applying
- Uses `MessageEditor` component pattern

**Diff Mode (Diff ON)**:
- Shows JSON diff between original and refined prompt
- Uses `DiffView` component
- Green = additions, Red = deletions
- Foldable unchanged sections

**Footer**:
- "Cancel" button (text style)
- "Use refined prompt" button (primary filled)

---

## Interaction Flows

### Flow 1: Initial Open (Empty State)

1. User clicks magic wand icon in prompt header
2. Modal opens with:
   - **Left Panel**: Empty area with input field ready
   - **Right Panel**: Empty state message "Submit instructions to see the refined prompt"
3. Diff toggle is disabled (nothing to compare yet)

### Flow 2: First Refinement

1. User types instructions in the input field
2. User clicks send (or presses Enter)
3. **Left Panel**:
   - User's guidelines appear as a bubble (right-aligned)
   - Loading indicator (Bubble with `loading={true}`)
4. **Right Panel**:
   - Shows loading skeleton
5. API call to `/ai/services/tools/call` with:
   - `prompt_template_json`: Original prompt
   - `guidelines`: User's instructions
6. On success:
   - **Left Panel**: AI explanation appears as bubble (left-aligned)
   - **Right Panel**: Refined prompt messages displayed in editable form
   - Diff toggle becomes enabled
7. On error:
   - Error toast notification
   - Error explanation appears as bubble
   - User can retry

### Flow 3: Subsequent Refinement (Iterative)

1. User types additional instructions
2. **Previous refined prompt** is used as input (not original)
3. Same loading/success/error flow as above
4. History of guidelines/explanations is preserved in bubble list

### Flow 4: Diff View Toggle

1. User toggles "Diff" switch ON
2. Right panel switches to `DiffView` component
3. Shows JSON diff: **original prompt** vs **current refined prompt**
4. Toggle OFF returns to editable message view

### Flow 5: Edit Before Apply

1. In normal mode (Diff OFF), user can edit any message content
2. Changes are local to the modal (not saved until "Use refined prompt")
3. Diff view reflects any manual edits made

### Flow 6: Apply Refined Prompt

1. User clicks "Use refined prompt"
2. Modal closes
3. Original prompt in Playground is replaced with refined version
4. Variant is marked as dirty (has unsaved changes)

### Flow 7: Cancel

1. User clicks "Cancel" or X button
2. Modal closes
3. No changes are applied
4. State is discarded

### Error States

| Scenario | UI Response |
|----------|-------------|
| AI Service disabled | Magic wand icon hidden or disabled |
| Rate limited (429) | Toast: "Too many requests. Please wait." |
| Auth error (401/403) | Toast: "Permission denied" |
| Service error (500) | Toast: "Service unavailable. Try again." |
| Invalid response | Bubble: "Failed to refine prompt. Please try different instructions." |

### Loading States

| Component | Loading State |
|-----------|---------------|
| Bubble list | Bubble with `loading={true}` |
| Right panel | Skeleton of message cards |
| Send button | Disabled with spinner |

---

## Component Architecture

### File Structure

```
web/oss/src/components/Playground/Components/
├── PlaygroundVariantConfigPrompt/
│   └── assets/
│       └── PlaygroundVariantConfigPromptCollapseHeader.tsx  # Add magic wand icon
│
└── Modals/
    └── RefinePromptModal/
        ├── index.tsx                    # Modal wrapper with EnhancedModal
        ├── types.ts                     # TypeScript interfaces
        ├── store/
        │   └── refinePromptStore.ts     # Jotai atoms for modal state
        ├── hooks/
        │   └── useRefinePrompt.ts       # API call hook
        └── assets/
            ├── RefinePromptModalContent.tsx    # Two-panel layout
            ├── InstructionsPanel/
            │   ├── index.tsx            # Left panel container
            │   └── InstructionsInput.tsx # Input + send button
            └── PreviewPanel/
                ├── index.tsx            # Right panel container
                ├── PreviewHeader.tsx    # Title + diff toggle + close
                ├── EmptyState.tsx       # Initial empty state
                ├── LoadingState.tsx     # Skeleton loading
                └── RefinedPromptView.tsx # Editable messages or diff
```

### Component Reuse Strategy

| Need | Reuse From | Notes |
|------|------------|-------|
| Modal container | `EnhancedModal` from `@agenta/ui` | Two-column layout like CommitModal |
| Bubble list | `Bubble`, `Bubble.List` from `@ant-design/x` | For guidelines/explanations display |
| Message editor | `MessageEditor` from `ChatCommon` | For editable refined messages |
| Diff view | `DiffView` from `Editor` | For JSON diff display |
| Input + Send | `Sender` from `@ant-design/x` or custom | For refinement input |
| Switch toggle | Ant Design `Switch` | For diff toggle |
| Loading skeleton | Ant Design `Skeleton` | For loading states |

### Key Component Props

```typescript
// RefinePromptModal
interface RefinePromptModalProps {
  open: boolean
  onClose: () => void
  variantId: string
  promptId: string
}

// InstructionsPanel
interface InstructionsPanelProps {
  iterations: RefinementIteration[]
  onSubmitGuidelines: (guidelines: string) => void
  isLoading: boolean
}

// RefinementIteration (NOT chat messages!)
interface RefinementIteration {
  id: string
  guidelines: string        // User's refinement instructions
  explanation: string       // AI's explanation of changes
  timestamp: number
}

// PreviewPanel
interface PreviewPanelProps {
  originalPrompt: PromptTemplate
  refinedPrompt: PromptTemplate | null
  showDiff: boolean
  onToggleDiff: (show: boolean) => void
  onClose: () => void
  onUpdateMessage: (index: number, content: string) => void
  isLoading: boolean
}

// PromptTemplate (matches backend contract)
interface PromptTemplate {
  messages: Array<{
    role: string
    content: string
  }>
  template_format?: string
  input_keys?: string[]
  llm_config?: Record<string, any>
}
```

---

## State Management

### Data Model: Refinement Iterations (NOT Chat Messages)

The key insight is that this is **not** a conversation. Each "turn" is a refinement request:
- User provides `guidelines`
- AI returns `messages` (refined) + `summary` (what changed)

```typescript
// A single refinement iteration
interface RefinementIteration {
  id: string
  guidelines: string      // What the user asked for
  explanation: string     // Summary of what the AI changed (from backend response)
  timestamp: number
}
```

### Modal State Atoms

```typescript
// store/refinePromptStore.ts

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

// Modal open state (scoped per prompt)
export const refineModalOpenAtomFamily = atomFamily((promptId: string) =>
  atom(false)
)

// Refinement iterations history (guidelines + explanations)
export const refineIterationsAtomFamily = atomFamily((promptId: string) =>
  atom<RefinementIteration[]>([])
)

// Current working prompt (starts as original, updated after each refinement)
// This is what gets sent to the next refinement API call
export const workingPromptAtomFamily = atomFamily((promptId: string) =>
  atom<PromptTemplate | null>(null)
)

// Loading state
export const refineLoadingAtomFamily = atomFamily((promptId: string) =>
  atom(false)
)

// Diff view toggle
export const refineDiffViewAtomFamily = atomFamily((promptId: string) =>
  atom(false)
)

// Original prompt snapshot (captured when modal opens, never changes)
// Used for diff comparison
export const originalPromptSnapshotAtomFamily = atomFamily((promptId: string) =>
  atom<PromptTemplate | null>(null)
)

// Pending guidelines (what user is currently typing)
export const pendingGuidelinesAtomFamily = atomFamily((promptId: string) =>
  atom<string | null>(null)
)
```

### State Flow

```
Modal Opens
    ↓
Capture original prompt → originalPromptSnapshotAtomFamily
                        → workingPromptAtomFamily (copy)
    ↓
User submits guidelines → pendingGuidelinesAtomFamily (for display)
                        → refineLoadingAtomFamily = true
    ↓
API call with:
  - prompt_template_json: workingPromptAtomFamily
  - guidelines: user input
    ↓
API returns → refineIterationsAtomFamily (add iteration with guidelines + explanation)
            → workingPromptAtomFamily (update to refined prompt)
            → refineLoadingAtomFamily = false
            → pendingGuidelinesAtomFamily = null
    ↓
User edits in preview → workingPromptAtomFamily (update)
    ↓
User applies → Copy workingPromptAtomFamily to playground state
```

### Bubble List Data Transformation

Transform `RefinementIteration[]` to Bubble.List items:

```typescript
const bubbleItems = useMemo(() => {
  const items: BubbleItem[] = []

  for (const iteration of iterations) {
    // User's guidelines (right-aligned)
    items.push({
      key: `${iteration.id}-guidelines`,
      placement: 'end',
      content: iteration.guidelines,
    })

    // AI's explanation (left-aligned)
    items.push({
      key: `${iteration.id}-explanation`,
      placement: 'start',
      content: iteration.explanation,
    })
  }

  // Add pending guidelines if loading
  if (pendingGuidelines && isLoading) {
    items.push({
      key: 'pending-guidelines',
      placement: 'end',
      content: pendingGuidelines,
    })
    items.push({
      key: 'loading',
      placement: 'start',
      loading: true,
    })
  }

  return items
}, [iterations, pendingGuidelines, isLoading])
```

### Integration with Playground State

When user clicks "Use refined prompt":

```typescript
// 1. Get working prompt from modal state (includes all refinements + edits)
const workingPrompt = get(workingPromptAtomFamily(promptId))

// 2. Convert to playground format (EnhancedObjectConfig)
const enhancedMessages = workingPrompt.messages.map((msg, idx) => ({
  __id: `msg-${idx}`,
  role: { value: msg.role },
  content: { value: msg.content },
}))

// 3. Update via molecule reducer
set(legacyAppRevisionMolecule.reducers.mutateEnhancedPrompts, revisionId, (draft) => {
  const promptIndex = draft.findIndex(p => p.__id === promptId)
  if (promptIndex !== -1) {
    draft[promptIndex].messages.value = enhancedMessages
  }
})

// 4. Clean up modal state
set(workingPromptAtomFamily(promptId), null)
set(refineIterationsAtomFamily(promptId), [])
set(originalPromptSnapshotAtomFamily(promptId), null)
set(refineModalOpenAtomFamily(promptId), false)
```

---

## API Integration

### API Client

```typescript
// web/oss/src/services/aiServices/api.ts

import axios from '@/oss/lib/api/assets/axiosConfig'

export interface RefinePromptResponse {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: {
    messages: Array<{ role: string; content: string }>
    summary?: string             // Short description of what changed
  }
  isError: boolean
  meta?: { trace_id?: string }
}

export interface AIServicesStatus {
  enabled: boolean
  tools: Array<{
    name: string
    title: string
    description: string
  }>
}

export const aiServicesApi = {
  async getStatus(): Promise<AIServicesStatus> {
    const { data } = await axios.get('/ai/services/status')
    return data
  },

  async refinePrompt(
    promptTemplate: PromptTemplate,
    guidelines: string,
    context?: string
  ): Promise<RefinePromptResponse> {
    const { data } = await axios.post('/ai/services/tools/call', {
      name: 'tools.agenta.api.refine_prompt',
      arguments: {
        prompt_template_json: JSON.stringify(promptTemplate),
        guidelines,
        context,
      },
    })
    return data
  },
}
```

### Hook for Refinement

```typescript
// hooks/useRefinePrompt.ts

import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { aiServicesApi } from '@/oss/services/aiServices/api'
import {
  refineIterationsAtomFamily,
  workingPromptAtomFamily,
  refineLoadingAtomFamily,
  pendingGuidelinesAtomFamily,
} from '../store/refinePromptStore'

export function useRefinePrompt(promptId: string) {
  const [iterations, setIterations] = useAtom(refineIterationsAtomFamily(promptId))
  const [workingPrompt, setWorkingPrompt] = useAtom(workingPromptAtomFamily(promptId))
  const [isLoading, setIsLoading] = useAtom(refineLoadingAtomFamily(promptId))
  const setPendingGuidelines = useSetAtom(pendingGuidelinesAtomFamily(promptId))

  const refine = useCallback(async (guidelines: string) => {
    if (!workingPrompt || !guidelines.trim()) return

    // Show pending state
    setPendingGuidelines(guidelines)
    setIsLoading(true)

    try {
      const response = await aiServicesApi.refinePrompt(workingPrompt, guidelines)

      if (response.isError) {
        throw new Error(response.content[0]?.text || 'Refinement failed')
      }

      // Parse refined prompt from messages array
      const refined = {
        messages: response.structuredContent!.messages,
        template_format: workingPrompt.template_format,
      }

      // Add iteration to history
      const iteration: RefinementIteration = {
        id: `iter-${Date.now()}`,
        guidelines,
        explanation: response.structuredContent?.summary ||
                     'Prompt refined based on your instructions.',
        timestamp: Date.now(),
      }
      setIterations(prev => [...prev, iteration])

      // Update working prompt for next iteration
      setWorkingPrompt(refined)

      return refined
    } catch (error) {
      // Add error iteration
      const errorIteration: RefinementIteration = {
        id: `iter-error-${Date.now()}`,
        guidelines,
        explanation: `Error: ${error.message}. Please try different instructions.`,
        timestamp: Date.now(),
      }
      setIterations(prev => [...prev, errorIteration])
      throw error
    } finally {
      setIsLoading(false)
      setPendingGuidelines(null)
    }
  }, [workingPrompt, setIterations, setWorkingPrompt, setIsLoading, setPendingGuidelines])

  return { iterations, workingPrompt, isLoading, refine, setWorkingPrompt }
}
```

---

## Implementation Plan

### Phase 1: Foundation (API + State + Dependencies)

**Tasks:**
1. Install `@ant-design/x` package if not already present
2. Create `web/oss/src/services/aiServices/api.ts` - API client
3. Create `RefinePromptModal/store/refinePromptStore.ts` - State atoms
4. Create `RefinePromptModal/types.ts` - TypeScript interfaces

### Phase 2: Modal Shell

**Files to create:**
- `RefinePromptModal/index.tsx`
- `RefinePromptModal/assets/RefinePromptModalContent.tsx`

**Tasks:**
1. Create modal wrapper using `EnhancedModal`
2. Implement two-column layout (following CommitModal pattern)
3. Add right panel header with diff toggle and close button
4. Add footer with Cancel and "Use refined prompt" buttons

### Phase 3: Instructions Panel (Left)

**Files to create:**
- `InstructionsPanel/index.tsx`
- `InstructionsPanel/InstructionsInput.tsx`

**Tasks:**
1. Create panel with header (title + subtitle)
2. Integrate `Bubble.List` from `@ant-design/x` for iteration display
3. Transform `RefinementIteration[]` to bubble items
4. Create input component with send button
5. Handle loading state with `loading` prop on Bubble

### Phase 4: Preview Panel (Right)

**Files to create:**
- `PreviewPanel/index.tsx`
- `PreviewPanel/PreviewHeader.tsx`
- `PreviewPanel/EmptyState.tsx`
- `PreviewPanel/LoadingState.tsx`
- `PreviewPanel/RefinedPromptView.tsx`

**Tasks:**
1. Create preview header with diff toggle
2. Create empty state for initial view
3. Create loading skeleton
4. Create refined prompt view using `MessageEditor` components
5. Integrate `DiffView` for diff mode

### Phase 5: Integration

**Files to modify:**
- `PlaygroundVariantConfigPromptCollapseHeader.tsx`

**Tasks:**
1. Add magic wand icon button to collapse header
2. Check AI services status to show/hide icon
3. Wire up modal open state
4. Implement "Use refined prompt" action to update playground state

### Phase 6: Refinement Hook

**Files to create:**
- `RefinePromptModal/hooks/useRefinePrompt.ts`

**Tasks:**
1. Create hook for API calls with loading/error handling
2. Implement iterative refinement (use workingPrompt, not original)
3. Manage iterations history

### Phase 7: Polish & Edge Cases

**Tasks:**
1. Add keyboard shortcuts (Enter to send, Escape to close)
2. Handle rate limiting gracefully
3. Add error boundaries
4. Test with various prompt structures
5. Ensure proper cleanup on modal close

---

## Backend Contract

The backend response returns `messages` (refined array) and `summary` (change description) in `structuredContent`:

```json
{
  "structuredContent": {
    "messages": [
      {"role": "system", "content": "Refined system content."},
      {"role": "user", "content": "Refined user content."}
    ],
    "summary": "Added explicit extraction format and improved role clarity."
  }
}
```

The `summary` is displayed as the AI's response bubble in the left panel.

---

## Notes

1. **Feature Flag**: Magic wand icon should only appear when AI services are enabled (check via `GET /ai/services/status`)

2. **Permissions**: The refine feature requires `EDIT_WORKFLOWS` permission (EE only)

3. **Rate Limiting**: Backend enforces 10 burst / 30 per minute. Frontend should show appropriate feedback.

4. **Iterative Context**: Each refinement uses the **workingPrompt** (not original) to build on previous improvements.

5. **Not a Chat**: The backend API is NOT a chat. It takes `guidelines` and returns `messages` + `summary`. The state models this as `RefinementIteration[]`, not chat messages.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@ant-design/x` | Bubble, Bubble.List, Sender components |
| `@phosphor-icons/react` | MagicWand icon |
| `jotai` | State management (already in project) |

Sources:
- [Bubble - Ant Design X](https://x.ant.design/components/bubble/)
- [Ant Design X Overview](https://x.ant.design/components/overview/)
