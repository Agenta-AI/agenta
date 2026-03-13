# Dark Mode - Context

## Background

Dark mode has become a standard feature in modern web applications. Users expect the ability to switch between light and dark themes based on their preferences or system settings, especially for tools they use for extended periods.

Agenta is a developer-focused platform where users spend significant time reviewing traces, evaluations, and building prompts. Dark mode support would improve:
- User comfort during extended use
- Accessibility for users with light sensitivity
- Professional appearance and feature parity with competing tools

## Motivation

1. **User Request:** Dark mode is a commonly requested feature
2. **Existing Infrastructure:** We already have partial dark mode infrastructure that's currently disabled
3. **Developer Tool Standard:** Most developer tools (VS Code, GitHub, etc.) offer dark mode

## Goals

1. **Full Dark Mode Support:** Users can switch between light/dark/system themes
2. **Consistent Experience:** All components, pages, and UI elements respect the theme
3. **System Preference Detection:** Auto-detect and respect OS-level dark mode preference
4. **Persistence:** Remember user's theme choice across sessions
5. **Smooth Transitions:** Theme switches should not cause jarring visual changes

## Non-Goals

1. **Custom Themes:** We're not building a theme builder - just light/dark modes
2. **Per-Component Theming:** Users won't be able to theme individual sections differently
3. **High Contrast Mode:** Accessibility-specific high contrast is out of scope (could be future enhancement)
4. **Immediate Full Coverage:** Some third-party components may have limited dark mode support initially

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| Large number of hardcoded colors | Phase the work, start with most visible components |
| Designer availability | Get all tokens upfront before starting implementation |
| Third-party library compatibility | Audit libraries, some may need CSS overrides |
| Testing coverage | Manual visual QA across all pages |
| Breaking existing styles | Careful review, feature flag for gradual rollout |

## Success Criteria

- [ ] User can toggle between Light/Dark/System themes
- [ ] Theme persists across browser sessions
- [ ] All Ant Design components render correctly in both modes
- [ ] Custom components and pages look correct in both modes
- [ ] Charts and visualizations are readable in dark mode
- [ ] No jarring white flashes during page navigation
- [ ] Documentation updated for future theming contributions
