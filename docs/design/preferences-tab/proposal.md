# Move the theme switch into Preferences

The breadcrumb bar carries a three-way theme switcher next to the version label —
permanent chrome for a control people set once, rendered as three unlabelled icons in
the row that truncates first on narrow screens. It belongs in settings.

| | Before | After |
|---|---|---|
| Theme switcher | Breadcrumb bar, right | Settings › Personal › Preferences |
| Tab name | Feature flags | Preferences |
| Tab layout | One flat list | Appearance, then Experiments |

The tab is renamed because a theme is not a flag, and a separate Appearance tab would
leave two Personal tabs holding two controls each. One tab, one place to look.

Preferences is visible in OSS and EE, so neither edition loses the control, and
`?tab=featureFlags` still resolves.

**The cost:** switching theme goes from one click to three.
