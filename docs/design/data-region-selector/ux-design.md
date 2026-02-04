# UX Design: Data Region Selector (Buttons)

## Intent

Add a small, clear region switcher to the Cloud sign-in screen using the same visual language as the existing social auth buttons.

## Design Principles

1. Non-intrusive: does not compete with sign-in CTAs
2. Clear state: obvious which region the user is currently on
3. Explicit switch: switching regions is a deliberate click and immediate redirect
4. Educational on demand: "Learn more" opens a modal (no confirmation modal)

## Key Assumption

EU Cloud may be served under `cloud.agenta.ai` (alias) and/or `eu.cloud.agenta.ai`. Both should work without forcing redirects between them.

---

## User Flows

### Flow A: User lands on EU (cloud alias or eu subdomain)

- Page shows EU as selected.
- Clicking US redirects to `us.cloud.agenta.ai` preserving `pathname + search + hash`.

### Flow B: User lands on US

- Page shows US as selected.
- Clicking EU redirects to `eu.cloud.agenta.ai` preserving `pathname + search + hash`.

### Flow C: User clicks Learn more

- Info modal opens; user can close and continue sign-in.

---

## Placement

Place the selector above the social auth buttons and above the email form, within the left auth column.

---

## Wireframes (ASCII)

### Desktop

```
Welcome to Agenta AI
Your All-In-One LLM Development Platform...

Data Region
┌─────────────────┐  ┌─────────────────┐
│ [selected] EU    │  │   US            │
│ (selected)       │  │                 │
└─────────────────┘  └─────────────────┘
This can be changed later. Learn more

[ Continue with Google ]
[ Continue with GitHub ]
--------- or ---------
[ email input ]
[ Continue ]
```

### Mobile

```
Welcome to Agenta

Data Region
┌───────────────┐  ┌───────────────┐
│ [selected] EU │  │   US          │
└───────────────┘  └───────────────┘
This can be changed later. Learn more

[ Google ]
[ GitHub ]
-- or --
[ email ]
[ Continue ]
```

---

## Visual States

- Selected:
  - stronger border/background (similar to primary button treatment)
  - optional checkmark icon
- Unselected:
  - subtle border (outline)
  - hover/focus treatment

---

## Learn More Modal (Content)

Title: `Data Regions`

Body:
- Agenta Cloud is available in two regions:
  - EU: Frankfurt, Germany
  - US: Virginia, USA
- Regions are completely separate. No data is shared between regions.
- Choose based on data residency and latency needs.
- You can have accounts in multiple regions (separate sign-up per region).

Optional:
- A link to a future docs page (if/when it exists).

---

## Redirect Behavior

- Clicking the other region redirects immediately.
- Preserve `pathname + search + hash`.
- If the user is on the EU alias host (`cloud.agenta.ai`) and EU is already selected, do nothing.
