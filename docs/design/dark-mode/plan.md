# Dark Mode - Execution Plan

## Overview

This plan is divided into phases to allow incremental delivery and minimize risk.

**Total Estimated Effort:** 3-5 weeks

---

## Phase 0: Designer Deliverables (Blocker)

**Owner:** Designer  
**Duration:** 1-2 weeks  
**Status:** Not Started

Before any implementation can begin, the designer must provide:

1. [ ] Dark mode color palette (see [designer-requirements.md](./designer-requirements.md))
2. [ ] Component token overrides for dark mode
3. [ ] Review of any custom UI patterns that need special handling

**Deliverable:** `antd-themeConfig-dark.json` file with all dark mode tokens

---

## Phase 1: Infrastructure Setup

**Owner:** Frontend Developer  
**Duration:** 2-3 days  
**Dependencies:** Phase 0 complete

### Tasks

1. [ ] **Enable dark mode in ThemeContextProvider**
   - Remove hardcoded `val = ThemeMode.Light`
   - Use `getAppTheme(themeMode)` instead
   - Update ConfigProvider to use `theme.darkAlgorithm` conditionally

2. [ ] **Create dark mode token loading**
   - Load appropriate token file based on theme
   - Or: Create combined token structure with light/dark variants

3. [ ] **Update Tailwind configuration**
   - Add dark mode variant support
   - Generate dark mode Tailwind tokens
   - Update `generate:tailwind-tokens` script

4. [ ] **Add theme toggle UI**
   - Add toggle in settings or header
   - Support Light / Dark / System options
   - Ensure persistence works

### Deliverable
- Theme toggle works
- Ant Design components switch between light/dark
- Custom components may look broken (expected)

---

## Phase 2: Core Layout & Navigation

**Owner:** Frontend Developer  
**Duration:** 3-4 days  
**Dependencies:** Phase 1 complete

### Tasks

1. [ ] **Fix Layout components**
   - `Layout.tsx` - Main container backgrounds
   - `Sidebar.tsx` - Navigation styling
   - `Header.tsx` - Top bar styling
   - `Breadcrumb` - Navigation breadcrumbs

2. [ ] **Fix global styles**
   - `globals.css` - Base element styles
   - Scrollbar styling for dark mode
   - Selection highlight colors

3. [ ] **Fix CSS-in-JS in layout**
   - `web/oss/src/components/Layout/assets/styles.ts`
   - Replace hardcoded colors with theme tokens

### Deliverable
- Navigation and layout look correct in dark mode
- Users can navigate the app without visual issues

---

## Phase 3: Feature Areas (Parallel Work Possible)

**Owner:** Frontend Developer(s)  
**Duration:** 1-2 weeks  
**Dependencies:** Phase 2 complete

Work on these areas can be parallelized across multiple developers:

### 3a. Playground
- [ ] Prompt input areas
- [ ] Parameter panels
- [ ] Output displays
- [ ] Monaco editor theme switching

### 3b. Evaluations
- [ ] Evaluation run list/table
- [ ] Result displays
- [ ] Score visualizations
- [ ] Comparison views

### 3c. Observability (Traces)
- [ ] Trace list table
- [ ] Span detail panels
- [ ] Attribute displays
- [ ] Timeline views

### 3d. Settings & Configuration
- [ ] Settings pages
- [ ] API key displays
- [ ] Environment configuration

### 3e. Charts & Visualizations
- [ ] Tremor chart components
- [ ] Custom data visualizations
- [ ] Status indicators

---

## Phase 4: Polish & Edge Cases

**Owner:** Frontend Developer  
**Duration:** 3-4 days  
**Dependencies:** Phase 3 complete

### Tasks

1. [ ] **Fix remaining hardcoded colors**
   - Audit for any remaining hex values
   - Update modal dialogs
   - Fix tooltip styling
   - Empty states and error pages

2. [ ] **Third-party component styling**
   - Monaco editor dark theme
   - ReactFlow dark styling
   - Markdown code block themes

3. [ ] **Transition smoothing**
   - Add CSS transitions for theme changes
   - Prevent flash of wrong theme on load
   - Handle SSR/hydration correctly

4. [ ] **Visual QA**
   - Test all pages in both themes
   - Check charts and data visualizations
   - Verify accessibility contrast ratios

---

## Phase 5: Documentation & Cleanup

**Owner:** Frontend Developer  
**Duration:** 1-2 days  
**Dependencies:** Phase 4 complete

### Tasks

1. [ ] **Update AGENTS.md**
   - Add theming guidelines
   - Document how to use theme tokens
   - Add lint rules or conventions for colors

2. [ ] **Create theming documentation**
   - How to add new themed components
   - Token reference guide
   - Dark mode testing checklist

3. [ ] **Code cleanup**
   - Remove any temporary workarounds
   - Clean up unused styles
   - Add TypeScript types for theme tokens

---

## Milestones

| Milestone | Target | Criteria |
|-----------|--------|----------|
| M1: Infrastructure Ready | Phase 1 done | Theme toggle works, Ant Design switches |
| M2: Layout Complete | Phase 2 done | Navigation usable in dark mode |
| M3: Features Complete | Phase 3 done | All major features themed |
| M4: Release Candidate | Phase 4 done | All visual issues resolved |
| M5: Release | Phase 5 done | Documentation complete, merged to main |

---

## Risk Mitigation

1. **Feature flag:** Consider adding a feature flag to enable dark mode only for testing initially
2. **Gradual rollout:** Can release with "beta" label to gather feedback
3. **Fallback:** Users can always switch back to light mode if issues found
4. **Regression testing:** Visual regression tests for critical components

---

## Resource Requirements

- **Designer:** 1-2 weeks upfront (Phase 0)
- **Frontend Developer:** 3-4 weeks implementation
- **QA:** Visual testing throughout Phase 3-4
- **Optional:** Second frontend developer to parallelize Phase 3
