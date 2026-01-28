# Research: Empty States

## Existing Patterns in Codebase

### Current Empty State Components

1. **`EmptyComponent`** - `web/oss/src/components/Placeholders/EmptyComponent/index.tsx`
   - Uses Ant Design's `<Empty />` with optional CTAs
   - JSS styling (legacy pattern)
   - Limited: no video/image support, basic layout

2. **`NoResultsFound`** - `web/oss/src/components/Placeholders/NoResultsFound/NoResultsFound.tsx`
   - For search/filter "no results" scenarios
   - Uses static image (`/assets/not-found.png`)
   - Different use case than first-run empty states

3. **Ant Design Table `locale.emptyText`**
   - Default empty state for tables
   - Can be customized per-table
   - Limited to table context (doesn't replace whole page)

### Where Empty States Are Needed

Found by searching for patterns like "No data", "No results", empty table states:

| Page/Component | Current State | Priority |
|----------------|---------------|----------|
| Evaluations (all types) | Default table empty | High |
| Testsets list | Default table empty | High |
| Traces/Observability | Default table empty | High |
| Playground variants | Has some empty state | Medium |
| Deployments | Default empty | Medium |
| Model Registry | Default empty | Low |

### Data Flow for Evaluations Table

The evaluation runs table uses `InfiniteVirtualTable` with `createInfiniteDatasetStore`:

```
evaluationRunsDatasetStore
  → evaluationRunsTableMetaAtom (filters, project, kind)
  → pagination.paginationInfo.totalCount
  → isEmptyState = totalCount === 0 && !isFetching && evaluationKind === "auto"
```

Key atoms:
- `evaluationRunsTableContextAtom` - Contains `evaluationKind`, `projectId`, etc.
- `evaluationRunsDatasetStore` - Manages table data fetching
- `evaluationRunsCreateModalOpenAtom` - Controls "New Evaluation" modal

### Technical Considerations

1. **When to show empty state**: Must wait for initial fetch to complete. Check `!isFetching` and `totalCount === 0`.

2. **Evaluation kind routing**: The `evaluationKind` is derived from URL param `?kind=auto|human|online|custom|all`.

3. **Create modal integration**: Empty state CTA should open the same modal as the "New Evaluation" button. Use `setIsCreateModalOpen(true)`.

4. **Asset serving**: 
   - OSS: `web/oss/public/assets/` → served at `/assets/`
   - EE: `web/ee/public/assets/` → served at `/assets/`
   - In dev, both are mounted but EE takes precedence

5. **Video considerations**:
   - `autoPlay` requires `muted` on most browsers
   - `playsInline` needed for iOS
   - `controlsList="nodownload"` hides download button
   - ~12MB for eval.mp4 - consider compression or CDN

## Langfuse Reference

Their empty state structure:

```html
<main class="flex-1 flex-col relative flex min-h-screen">
  <div class="mx-auto flex max-w-4xl flex-col items-center p-8">
    <!-- Title + Description -->
    <div class="mb-6 text-center">
      <h2 class="mb-2 text-2xl font-bold">Title</h2>
      <p class="text-muted-foreground">Description</p>
    </div>
    
    <!-- CTAs -->
    <div class="mb-8 flex flex-wrap justify-center gap-4">
      <Button primary>Primary CTA</Button>
      <Button secondary>Secondary CTA</Button>
    </div>
    
    <!-- Video -->
    <div class="my-6 w-full max-w-3xl rounded-lg border">
      <video autoplay loop muted playsinline controls />
    </div>
    
    <!-- Optional: Feature cards -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Cards explaining features -->
    </div>
  </div>
</main>
```

Key takeaways:
- `max-w-4xl` container (~896px)
- `max-w-3xl` for video (~768px)
- `p-8` generous padding
- CTAs use `px-8` for wider buttons
- Video has `controls` visible (not hidden)

## Icon Usage

Phosphor icons are used throughout the codebase:

```tsx
import {Play, ArrowRight} from "@phosphor-icons/react"

<Button icon={<Play size={16} />}>Run Evaluation</Button>
<Button icon={<ArrowRight size={16} />} iconPosition="end">Learn More</Button>
```

## Copy Guidelines

Based on Langfuse and existing Agenta copy:

- **Title**: Action-oriented, starts with verb or "Get Started with..."
- **Description**: 1-2 sentences max, focus on value/outcome
- **Primary CTA**: Verb + noun ("Run Evaluation", "Create Testset")
- **Secondary CTA**: "Learn More" or "View Docs"
