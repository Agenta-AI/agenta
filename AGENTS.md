# Contributor Guide

## Dev Environment Tips
- If you make changes to the frontend, make sure to run `pnpm format-fix` within the web folder
- If you make changes to the backend or sdk, make sure to run black within the sdk or api folder
- If you update Ant Design tokens, run `pnpm generate:tailwind-tokens` in the web folder and commit the generated file


## Testing Instructions
- Tests are currently still not working and should not be run 

## PR instructions
- If the user provides you with the issue id, title the PR: [issue-id] fix(frontend): <Title> where fix is the type (fix, feat, chore, ci, doc, test.. [we're using better-branch) and frontend is where and it could be api, sdk, frontend, docs, ..


### Architecture Overview

Our folder structure follows a module-based architecture that prioritizes maintainability, reusability, and clear separation of concerns.

#### Core Principles

1. **Modular Organization**

    - Modules represent distinct feature areas (similar to pages)
    - Each module is self-contained with its own components, hooks, and assets
    - Shared functionality is elevated to appropriate hierarchy levels

2. **Component Structure**

    - Components are organized by their scope of use
    - Each component may contain:
        - Presentational logic (`Component.tsx`)
        - UI-only subcomponents (`components/*.tsx`)
        - Component-specific hooks (`hooks/*.ts`)
        - Local constants and utilities (`assets/*.ts`)
        - Type definitions (`types.d.ts`)

3. **Code Movement Guidelines**
   The following rules determine where code should live:
    - Module-specific code stays within the module
    - Components used across multiple modules move to root `/components`
    - Hooks used across multiple modules move to root `/hooks`
    - UI elements, constants, or utilities used across modules move to root `/assets`
    - Types used across modules move to root `types.d.ts`

#### State Management

1. **Store Organization**

 - Each module can have its own `store` folder containing:
     - Jotai atoms for reactive state
   - Global store at root level for cross-module state

2. **State Movement Guidelines**

    - State used only within a component stays as local state
    - State shared between components in a module uses module-level store
    - State shared across modules moves to root `/store`
    - Consider these factors when choosing state location:
        - Scope of state usage
        - Frequency of updates
        - Performance implications
        - Data persistence requirements

3. **State Management Tools**
   - Prefer Jotai atoms for all kind of shared state
   - Local component state for UI-only concerns

#### Implementation Strategy

-   **Current Approach**: Gradual adoption during regular development
-   **Migration**: Update components to follow this structure as they are modified
-   **No Big Bang**: Avoid large-scale refactoring
-   **Progressive Enhancement**: Easy to implement incrementally

This structure supports:

-   Clear ownership and responsibility
-   Easy code review and modification
-   Identification of reusable patterns
-   Natural code organization based on usage
-   Scalable architecture that grows with the application

### State and Data Fetching (Jotai-First)

We now prefer Jotai atoms (especially `atomWithQuery`) for shared state and data fetching/caching. Keep local component state local; promote to atoms when the state is shared across multiple components or needs caching.

- Use `atomWithQuery` for data fetching/caching.
- For realistic patterns, review the `state` directory for existing atoms and queries.

#### Example: use `atomWithQuery` for shared/cached data

```javascript
import { atomWithQuery } from "jotai-tanstack-query";
import { useAtomValue } from "jotai";
import { queryClient } from "@/state/queryClient";
import api from "@/oss/lib/helpers/axios";

// shared atom
export const usersAtom = atomWithQuery(
  () => ({
    queryKey: ["users"],
    queryFn: async () => {
      const { data } = await api.get("/api/users");
      return data;
    },
  }),
  { queryClient }
);

// consuming component
function UsersList() {
  const { data, isLoading, error } = useAtomValue(usersAtom);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading users</div>;

  return <div>{data.map((u) => u.name).join(", ")}</div>;
}
```

#### Legacy `useSWR` usage

We still have existing `useSWR` hooks. When touching them:

- Replace with `atomWithQuery` where practical.
- Keep returned variables/signatures the same to avoid wide refactors.
- Do not introduce inline arrays or heavy inline props; memoize as needed.

### UI Components (Enhanced variants)

- Prefer Enhanced `Table`, `Drawer`, and `Modal` components instead of raw Ant Design equivalents. Read the Enhanced components docs before using.
- When adding buttons that need a tooltip, use `EnhancedButton` (wraps tooltip behavior).
- Follow module/component placement rules above; keep shared UI elements in the appropriate shared folders.

### React Best Practices

#### Avoiding Inline Array Props

Passing inline arrays of objects with heavy content such as JSX is considered a bad practice in React. This is because it can lead to unnecessary re-renders and performance issues. When you pass an inline array, a new array is created every time the component renders, causing React to think that the prop has changed even if the content is the same.

For example, in the `AccordionTreePanel` component, the `items` prop is passed an inline array of objects with JSX content:

❌ **Avoid this pattern:**

```javascript
<AccordionTreePanel
  items={[
    {
      title: "Item 1",
      content: <div>Content 1</div>,
    },
    {
      title: "Item 2",
      content: <div>Content 2</div>,
    },
  ]}
/>
```

✅ **Use this pattern:**

```javascript
import {useMemo} from "react"

const items = useMemo(
    () => [
        {
            title: "Item 1",
            content: <div>Content 1</div>,
        },
        {
            title: "Item 2",
            content: <div>Content 2</div>,
        },
    ],
    [],
)

<AccordionTreePanel items={items} />
```
