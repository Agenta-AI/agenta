# Data Region Selector - Planning Workspace

This workspace contains the design and implementation plan for adding data region selection to Agenta Cloud's sign-in experience.

## Overview

Agenta Cloud now operates in two regions:
- **EU** - `eu.cloud.agenta.ai` (default)
- **US** - `us.cloud.agenta.ai`

Users need to be able to choose their data region when signing up or signing in.

## Documents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, motivation, goals, and non-goals |
| [research.md](./research.md) | Codebase analysis, Langfuse reference, technical considerations |
| [plan.md](./plan.md) | High-level execution plan with phases |
| [ux-design.md](./ux-design.md) | User experience design with wireframes |
| [design-issue.md](./design-issue.md) | **Design handoff** - Issue description for designer |
| [status.md](./status.md) | Living document with progress updates |

## Quick Summary

- **When shown**: Only on Agenta Cloud (when `NEXT_PUBLIC_AGENTA_CLOUD_REGION` is set)
- **Region detection**: `NEXT_PUBLIC_AGENTA_CLOUD_REGION` (EU deployment may be reachable via both `cloud.agenta.ai` and `eu.cloud.agenta.ai`)
- **Default behavior**: `cloud.agenta.ai` remains an EU alias (no preference-based auto-redirect in v1)
- **Switching**: Two button-style selectors; clicking the other region redirects immediately; no confirmation modal
- **Education**: Inline helper text + "Learn more" opens an info modal

## Key Technical Decisions

1. **New env var**: `NEXT_PUBLIC_AGENTA_CLOUD_REGION` (values: `"eu"` | `"us"`)
2. **Cloud check**: show selector only when the env var is set to a valid region
3. **UI pattern**: Button-style selectors (like Google/GitHub buttons) + "Learn more" info modal
4. **Direct redirect**: Clicking other region redirects immediately (no confirmation)
