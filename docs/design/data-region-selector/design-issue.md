# Design Issue: Data Region Selector for Sign-In Page

## Context

We now have two Agenta Cloud instances:
- **EU Region**: `eu.cloud.agenta.ai` - Data stored in Frankfurt, Germany
- **US Region**: `us.cloud.agenta.ai` - Data stored in Virginia, USA

Users need to be able to:
1. See which region they're currently on
2. Switch between regions
3. Understand what "data regions" means (optional, for curious users)

## Reference: Langfuse

Langfuse has a similar feature we can reference: [Langfuse Sign-In Page](https://cloud.langfuse.com)

Their pattern:
- Dropdown selector below the auth form
- "(what is this?)" link opens info dialog
- Direct redirect on selection (no confirmation modal)

We will **not** use the dropdown. We will use two button-style selectors for EU/US.

## Requirements

### 1. Region Selector Component

**Location:** On the sign-in page, above the social auth buttons (Google, GitHub)

**Elements:**
- Label: "Data Region"
- Two button-style selectors (same style as Google/GitHub buttons):
  - EU
  - US
- Helper text: "This can be changed later. Learn more"
- "Learn more" link opens info modal

**Visual States:**
- **Selected:** Highlighted (like primary/filled button); optional checkmark icon
- **Unselected:** Outlined/subtle (like secondary button), clickable

**Behavior:**
- Selected state reflects current region (based on URL domain)
- Clicking the unselected region → redirects to that region's domain
- "Learn more" → opens info modal

### 2. Info Dialog

**Trigger:** "Learn more" link

**Content (suggested):**
```
Data Regions

Agenta Cloud is available in two regions:
- EU (Frankfurt, Germany)
- US (Virginia, USA)

Regions are completely separate - no data is shared between them.
Choose a region close to you for better performance and to comply
with data residency requirements (like GDPR).

You can have accounts in multiple regions, but each requires a
separate sign-up.

[Learn more ->] (link to docs)
```

### 3. States

- **Default state:** Shows current region (selected styling)
- **Loading:** When redirecting (optional spinner)

### 4. Responsive Design

- Desktop: Can be in the left panel or in a card below the form
- Mobile: In the auth form area (side banner is hidden on mobile)

## Wireframes (ASCII)

### Desktop

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌─────────────────────────┐   ┌───────────────────────────┐  │
│  │                         │   │                           │  │
│  │  Agenta                  │   │   [Side Banner]           │  │
│  │                         │   │                           │  │
│  │  Welcome to Agenta AI   │   │                           │  │
│  │  Your LLM Platform...   │   │                           │  │
│  │                         │   │                           │  │
│  │  Data Region            │   │                           │  │
│  │  ┌──────────┐┌─────────┐│   │                           │  │
│  │  │ [selected] EU ││  US  ││   │                           │  │
│  │  │[selected]││         ││   │                           │  │
│  │  └──────────┘└─────────┘│   │                           │  │
│  │  This can be changed    │   │                           │  │
│  │  later. Learn more      │   │                           │  │
│  │                         │   │                           │  │
│  │  [Continue with Google] │   │                           │  │
│  │  [Continue with GitHub] │   │                           │  │
│  │                         │   │                           │  │
│  │  ─────── or ───────     │   │                           │  │
│  │                         │   │                           │  │
│  │  [email input]          │   │                           │  │
│  │  [Continue]             │   │                           │  │
│  │                         │   │                           │  │
│  └─────────────────────────┘   └───────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌─────────────────────┐
│                     │
│  Agenta            │
│                     │
│  Welcome to Agenta  │
│                     │
│  Data Region        │
│  ┌───────┐┌───────┐ │
│  │[selected] EU││ US │ │
│  └───────┘└───────┘ │
│  Can be changed     │
│  later. Learn more  │
│                     │
│  [Google]           │
│  [GitHub]           │
│  ───── or ─────     │
│  [email input]      │
│  [Continue]         │
│                     │
└─────────────────────┘
```

### Info Dialog

```
┌───────────────────────────────────┐
│  Data Regions               x     │
├───────────────────────────────────┤
│                                   │
│  Agenta Cloud is available in     │
│  two regions:                     │
│                                   │
│  EU - Frankfurt, Germany          │
│  US - Virginia, USA               │
│                                   │
│  Regions are completely separate. │
│  Choose based on your location    │
│  and compliance needs.            │
│                                   │
│  Learn more about data regions -> │
│                                   │
└───────────────────────────────────┘
```

## Design Considerations

1. **Visual consistency:** Region buttons should match the style of Google/GitHub auth buttons
2. **Clear selection:** Selected state must be obviously different from unselected
3. **Visual hierarchy:** Region selector shouldn't compete with auth buttons - it's secondary
4. **Trust:** Region selection relates to data security, design should feel trustworthy
5. **Helper text:** "This can be changed later" reassures users it's not a permanent choice

## Out of Scope (for now)

- Region indicator in the main app (post-login) - can be Phase 2
- Account settings page showing region
- Region in invite emails

## Questions for Design

1. Should the region buttons be full-width (stacked) or side-by-side?
2. What visual treatment for selected vs unselected? (filled vs outlined? border color? checkmark?)
3. Should we show just "EU" / "US" or include location ("EU - Frankfurt")?
4. How to style the "Learn more" link - subtle text link or more prominent?

## Assets Needed

- [ ] Region button component - selected state
- [ ] Region button component - unselected state  
- [ ] Region button component - hover state
- [ ] Info modal design
- [ ] Mobile layout
