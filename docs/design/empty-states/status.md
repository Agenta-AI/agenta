# Status: Empty States

## Current State

**Phase 1 & 2 are complete. All evaluation empty states and observability are implemented.**

### What's Working

#### Core Component
- `EmptyState` component at `web/oss/src/components/EmptyState/`
- Uses Cloudflare Stream for video previews (`@cloudflare/stream-react`)
- Video IDs defined in `web/oss/src/components/EmptyState/videos.ts`
- Layout follows Langfuse pattern: Title -> Description -> CTAs -> Video
- Fallback support for local video/image files

#### Evaluation Empty States (All Complete)
- **Auto Evaluations**: `EmptyStateEvaluation` - Uses video preview, CTA opens NewEvaluation modal
- **Human Evaluations**: `EmptyStateHumanEvaluation` - Uses video preview, CTA opens NewEvaluation modal
- **Online/Live Evaluations**: `EmptyStateOnlineEvaluation` - Uses online eval video, CTA opens NewEvaluation modal
- **SDK/Custom Evaluations**: `EmptyStateSdkEvaluation` - Simple text-based empty state, CTA opens SetupEvaluationModal with SDK code snippets
- **All Evaluations tab**: `EmptyStateAllEvaluations` - Uses video preview, CTA opens NewEvaluation modal

All wired into `EvaluationRunsTable` - renders appropriate empty state based on `evaluationKind` when `totalCount === 0`.

#### Observability Empty State (Complete)
- Simple text-based empty state (no video in table)
- CTA "Set Up Tracing" triggers `SetupTracingModal` via `onboardingWidgetActivationAtom`
- Secondary CTA links to docs

### Design Patterns

**Two types of empty states:**

1. **Video-based** (Auto, Human, Online, All Evaluations):
   - Full `EmptyState` component with Cloudflare Stream video
   - Good for feature discovery and engagement

2. **Modal-triggered** (SDK Evaluations, Observability):
   - Simple text + icon + CTAs
   - Primary CTA opens setup modal with code snippets
   - Better UX for action-oriented flows (e.g., "copy this code")

### Cloudflare Stream Video IDs
| Video | ID | Used For |
|-------|----|---------| 
| evaluation | `9b461c23c4ea1ede1ace385eebcf2f4e` | All, Auto, Human Evals |
| onlineEvaluation | `0cba3038f5459793ab3c3f488ee232e8` | Online/Live Evals |
| observability | `bef869beb65a269388b806a79cd77109` | (Available, not currently used) |

### Test Environment

- URL: `http://144.76.237.122:8380`
- Compose project: `agenta-ee-dev-empty-state-poc`
- Ports: 8380 (web), 8381 (traefik), 5435 (postgres)
- Env file: `hosting/docker-compose/ee/.env.ee.dev.local`

To see empty states: Navigate to any evaluation tab or Observability on a project with no data.

### Known Issues

1. **"Under tabs" feeling**: The empty state renders in the table content area, which is below the evaluation type tabs. This creates a slight visual disconnect. Not blocking, but worth revisiting.

2. **Assets in EE only**: Local fallback videos are in `web/ee/public/assets/`. Need to also add to `web/oss/public/assets/` for OSS builds (though Cloudflare Stream is primary now).

## Recent Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-28 | Observability empty state opens modal | Showing setup content inline in table felt out of place |
| 2026-01-28 | SDK eval empty state opens SetupEvaluationModal | Code snippets are more actionable in dedicated modal |
| 2026-01-28 | Switch to Cloudflare Stream | Better performance, no need to bundle large video files |
| 2026-01-16 | Use video (mp4) instead of GIF | Smaller file size, user has playback controls, better UX |
| 2026-01-16 | CTAs above preview | Follows Langfuse pattern, actions visible without scrolling |
| 2026-01-16 | Replace table entirely (not just empty cell) | Cleaner UX, empty state deserves full attention |

## Next Steps

1. Test all empty states in deployed environment
2. Consider addressing "under tabs" issue (if deemed important)
3. Extend to Testsets page (Phase 3)
4. Copy local video assets to OSS public folder (for offline/fallback)

## Files Changed

```
web/oss/src/components/EmptyState/
├── EmptyState.tsx          # Reusable component with Cloudflare Stream
├── videos.ts               # Video ID constants
└── index.ts                # Export

web/oss/src/components/pages/evaluations/
├── allEvaluations/EmptyStateAllEvaluations/
├── autoEvaluation/EmptyStateEvaluation/
├── humanEvaluation/EmptyStateHumanEvaluation/
├── onlineEvaluation/EmptyStateOnlineEvaluation/
└── sdkEvaluation/EmptyStateSdkEvaluation/   # Simple text-based, opens modal

web/oss/src/components/pages/observability/components/EmptyObservability/
  # Simple text-based, opens SetupTracingModal

web/oss/src/components/EvaluationRunsTablePOC/components/EvaluationRunsTable/index.tsx
  # Wired up all evaluation empty states

web/oss/package.json
  # Added @cloudflare/stream-react dependency

web/ee/public/assets/
├── eval.gif                # Original GIF (unused now)
└── eval.mp4                # Local video fallback
```
