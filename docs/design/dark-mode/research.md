# Dark Mode - Research & Findings

## Current Theming Infrastructure

### Theme Context Provider
**Location:** `web/oss/src/components/Layout/ThemeContextProvider.tsx`

The infrastructure for dark mode **already exists** but is disabled:

```typescript
// ThemeMode enum supports all modes
export enum ThemeMode {
    Light = "light",
    Dark = "dark",
    System = "system"
}

// System detection is implemented
const getDeviceTheme = () => {
    if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? ThemeMode.Dark
            : ThemeMode.Light
    }
    return ThemeMode.Light
}

// BUT: Line 67 hardcodes light mode, ignoring user preference
const val = ThemeMode.Light  // <-- This disables dark mode
```

**Why it's disabled:** The variable `val` is hardcoded to `ThemeMode.Light` instead of using the stored preference. This is likely because dark mode tokens weren't fully implemented.

### Theme Context Bridge (react-jss)
**Location:** `web/oss/src/ThemeContextBridge.tsx`

Bridges Ant Design tokens to react-jss, providing `isDark` flag:
```typescript
<ThemeProvider theme={{...token, isDark: appTheme === "dark"}}>
```

This means CSS-in-JS can access `theme.isDark` for conditional styling.

---

## Token System

### Ant Design Tokens
**Location:** `web/oss/src/styles/tokens/antd-themeConfig.json`

A ~1400 line JSON file containing:
- Color palette (blue, cyan, red, green, etc. with 10 shades)
- Semantic colors (colorPrimary, colorError, colorText, etc.)
- Component-specific tokens (Button, Input, Table, etc.)
- Custom `zinc` palette for grays

**Current primary colors:**
```json
{
  "colorPrimary": "#1c2c3d",
  "colorText": "#1c2c3d",
  "colorTextSecondary": "#586673",
  "colorTextTertiary": "#758391",
  "colorBgContainer": "#ffffff",
  "colorBgLayout": "#ffffff",
  "colorBorder": "#bdc7d1",
  "colorBorderSecondary": "#eaeff5"
}
```

### Tailwind Token Integration
**Location:** `web/oss/src/styles/tokens/antd-tailwind.json`

Maps Ant Design tokens to Tailwind-compatible format. Used in `tailwind.config.ts`:
```typescript
import antdTailwind from "./src/styles/tokens/antd-tailwind.json"
// ...
colors: {
    ...antdTailwind,
}
```

### Token Generation
**Command:** `pnpm generate:tailwind-tokens` (defined in package.json)

This script generates the Tailwind token file from Ant Design config. Will need updating for dark mode.

---

## Color Usage Patterns Analysis

### Problem: Hardcoded Colors

Found **100+ occurrences** of hardcoded hex colors in TSX files:

```typescript
// Examples of problematic patterns
<div className="bg-[#FAFAFB]">
<div className="text-[#344054]">
<div className="border-[#E4E7EC]">
<Tag className="!bg-[#EEF2FF] !border-[#E0EAFF]">
className="border-[rgba(5,23,41,0.06)]"
```

**Files with most hardcoded colors:**
- Playground components
- Evaluation result displays
- Table cell renderers
- Status indicators and tags

### CSS-in-JS Hardcoded Colors

**Location:** `web/oss/src/components/Layout/assets/styles.ts` (and ~30 other files)

```typescript
const useStyles = createUseStyles((theme: JSSTheme) => ({
    layout: ({themeMode}: StyleProps) => ({
        background: themeMode === "dark" ? "#141414" : "#ffffff",  // Hardcoded
    }),
    breadcrumbContainer: {
        borderBottom: "1px solid #eaeff5",  // Hardcoded
    },
}))
```

### Good Patterns (Already Theme-Aware)

Some components properly use theme tokens:

```typescript
// Using react-jss theme tokens - GOOD
const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        color: theme.colorText,  // Token reference
    },
}))

// Using Tailwind semantic classes - GOOD
className="text-colorText"
className="bg-colorBgContainer"
className="border-colorBorder"

// Using CSS variables - GOOD
className="border-[var(--ant-color-border)]"
```

---

## Components Using Theme

Files that import `useAppTheme`:
- `Layout.tsx` - Main layout
- `Sidebar.tsx` - Navigation sidebar
- `Logo.tsx` - Logo component
- `ChatInputs.tsx` - Chat interface
- `CompareOutputDiff.tsx` - Diff viewer
- Several EE components

These components are already theme-aware and will work once dark mode is enabled.

---

## Third-Party Library Considerations

### Tremor (Charts)
**Good news:** Tailwind config already has `dark-tremor` colors defined:
```typescript
colors: {
    tremor: { /* light mode */ },
    "dark-tremor": { /* dark mode - already configured */ },
}
```

### Monaco Editor
Used in playground for code editing. Has built-in dark theme support (`vs-dark`).

### ReactFlow
Used for workflow visualization. Supports theming via CSS variables.

### Markdown Renderers
May need custom styling for code blocks in dark mode.

---

## Audit Summary

| Category | Count | Effort |
|----------|-------|--------|
| Files with hardcoded hex in className | ~50 | High |
| Files with hardcoded CSS-in-JS colors | ~30 | Medium |
| CSS files with hardcoded colors | ~5 | Low |
| Already theme-aware components | ~15 | None |
| Third-party libraries needing dark support | ~4 | Medium |

---

## Quick Win: Enable Basic Dark Mode

To immediately test dark mode with Ant Design components:

1. In `ThemeContextProvider.tsx`, change line 67:
```typescript
// From:
const val = ThemeMode.Light

// To:
const val = getAppTheme(themeMode)
```

2. Update ConfigProvider to use dark algorithm:
```typescript
algorithm: val === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
```

This will make all Ant Design components dark-mode aware immediately, revealing which custom components need work.

---

## Files Requiring Updates

### High Priority (Most Visible)
1. `ThemeContextProvider.tsx` - Enable dark mode
2. `antd-themeConfig.json` - Add dark mode token values
3. `globals.css` - Dark mode base styles
4. Layout components - Header, Sidebar, Main content areas

### Medium Priority (Feature Areas)
1. Playground components
2. Evaluation displays
3. Trace/Observability views
4. Settings pages

### Low Priority (Less Visible)
1. Modal dialogs
2. Tooltips
3. Empty states
4. Error pages
