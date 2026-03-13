# Dark Mode Feature Planning

This workspace contains planning documents for adding dark mode support to Agenta.

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, goals, and non-goals |
| [research.md](./research.md) | Current state analysis, codebase findings, technical discoveries |
| [plan.md](./plan.md) | High-level execution plan with phases |
| [designer-requirements.md](./designer-requirements.md) | What the designer needs to provide |
| [status.md](./status.md) | Living progress tracker (update as work progresses) |

## Quick Summary

**Current State:** Agenta has partial dark mode infrastructure (theme context, localStorage persistence, system detection) but it's disabled. There are 100+ hardcoded colors throughout the codebase that would need refactoring.

**Estimated Effort:** 3-5 weeks for full implementation

**Designer Required:** Yes - must provide dark mode color palette and component tokens before implementation can proceed.

## Key Files Reference

| Purpose | File Path |
|---------|-----------|
| Theme Provider | `web/oss/src/components/Layout/ThemeContextProvider.tsx` |
| Ant Design Tokens | `web/oss/src/styles/tokens/antd-themeConfig.json` |
| Tailwind Tokens | `web/oss/src/styles/tokens/antd-tailwind.json` |
| Tailwind Config | `web/oss/tailwind.config.ts` |
