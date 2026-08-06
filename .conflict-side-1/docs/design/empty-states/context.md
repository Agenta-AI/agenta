# Context: Empty States

## Problem Statement

Empty states across Agenta are inconsistent and don't guide users toward taking action. When users land on a page with no data (no evaluations, no testsets, no traces, etc.), they see either:
- A blank table with "No data"
- Ant Design's default `<Empty />` component
- Nothing at all

This creates a poor first-run experience and misses an opportunity to educate users and drive feature adoption.

## Goals

1. **Consistent UX**: Unified empty state pattern across all major pages
2. **Action-oriented**: Every empty state should have a clear primary CTA
3. **Educational**: Use the empty state to explain the feature's value
4. **Visual**: Include preview media (video/GIF) to show what the feature looks like when populated
5. **Reusable**: Single component that can be configured for different contexts

## Non-Goals

- Redesigning the entire onboarding flow
- Adding feature tours or walkthroughs (separate initiative)
- Changing empty states for search/filter results (different pattern)

## Inspiration

Langfuse's empty state pattern:
- Title + description above CTAs
- Primary + secondary buttons (Create / Learn More)
- Video preview below CTAs with autoplay + loop
- Optional feature cards grid (we're skipping for now)

## Success Criteria

- All major pages have consistent empty states
- Users can take action directly from empty state (not hunt for buttons)
- Video/GIF previews load quickly and don't block interaction
