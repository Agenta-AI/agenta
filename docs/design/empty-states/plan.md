# Implementation Plan: Empty States

## Phase 1: POC (DONE)

- [x] Create reusable `EmptyState` component
- [x] Implement for Auto Evaluations page
- [x] Support video (mp4) and image (gif/png) previews
- [x] Layout: Title → Description → CTAs → Preview
- [x] Deploy and test in worktree environment

## Phase 2: Evaluations Pages (DONE)

- [x] **Auto Evaluations** - Using Cloudflare Stream video
- [x] **Human Evaluations** - Same pattern, shares evaluation video
- [x] **Online/Live Evaluations** - Uses dedicated online evaluation video
- [x] **SDK/Custom Evaluations** - Same pattern, links to SDK docs
- [x] **All Evaluations tab** - Shows generic evaluation empty state
- [x] Switch to Cloudflare Stream for video hosting

All evaluation empty states are wired into `EvaluationRunsTable` and render based on `evaluationKind`.

## Phase 3: Other Pages (IN PROGRESS)

Priority order based on user journey:

1. [x] **Observability/Traces** - "Start Observing Your LLM" (uses observability video)
2. [ ] **Testsets** - "Create your first testset"
3. [ ] **Playground** - "Create your first prompt" (may already have good empty state)
4. [ ] **Deployments** - "Deploy your first variant"

### Content Needed (Phase 3)
| Page | Video/GIF | Title | Description | Primary CTA | Secondary CTA |
|------|-----------|-------|-------------|-------------|---------------|
| Testsets | TBD | "Get Started with Testsets" | TBD | "Create Testset" | "Learn More" |

## Phase 4: Polish & Edge Cases

- [ ] Handle loading states (skeleton while video loads?)
- [ ] Handle error states (video fails to load)
- [ ] Mobile responsiveness audit
- [ ] Dark mode support
- [ ] Accessibility audit (video captions, aria labels)
- [ ] Performance audit (lazy load videos?)

## Phase 5: Banner Variant (Stretch)

For pages that have default items (like Testsets with sample data):
- Horizontal layout instead of vertical
- Smaller preview
- "Tip" or "Getting Started" banner style
- Can be dismissed

## Open Questions

1. **Tabs issue**: Empty state renders below tabs which feels slightly off. Options:
   - Replace entire tab content area (current approach)
   - Replace the whole page including tabs when ALL tabs are empty
   - Keep as-is (minor issue)

2. ~~**Video hosting**: Currently in `/assets/`. Should we:~~
   - ~~Keep in repo (simpler, works offline)~~
   - ~~Host on CDN (smaller repo, faster loads)~~
   - ~~Use YouTube/Vimeo embeds (analytics, but slower)~~
   
   **RESOLVED**: Using Cloudflare Stream with local fallback option.

3. **Per-tab vs global empty state**: When on "All Evaluations" tab with no data:
   - ~~Show one empty state for all?~~
   - ~~Show tabs with individual empty states per type?~~
   
   **RESOLVED**: Show generic "All Evaluations" empty state on the All tab.
