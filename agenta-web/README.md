# Web app

This directory contains the code source for the web app for Agenta AI.

## Installation

Please see the Readme.md in the main dir for installation and usage instructions.

## Configuration for Better Development Experience

### Visual Studio Code Users

To have a better experience while working on the client application, you can configure certain plugins in your workspace `settings.json`.

#### ESLint

To ensure ESLint functions properly, add the following configuration:

```json
{
    "eslint.workingDirectories": [
        {
            "mode": "auto"
        }
    ]
}
```

#### Prettier

To ensure Prettier functions properly, add the following configuration:

```json
{
    "prettier.prettierPath": "./agenta-web/node_modules/prettier"
}
```

## Contribution Guidelines

### Folder Structure

Below is the folder structure of the `./agenta-web/src` directory:

```text
agenta-web/src
├── Common
│   ├── assets
│   │   ├── constants.ts
│   │   ├── utils.ts
│   │   ├── UIElement1.tsx
│   ├── components
│   │   ├── Component1
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── utils.ts
│   │   │   │   ├── Component1UIElement.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useComponent1Hook.ts
│   │   │   │   ├── types.d.ts
│   │   ├── Component.tsx
│   ├── hooks
│   │   ├── useSharedHook1.ts
│   │   ├── useSharedHook2.ts
│   ├── pages
│   │   ├── Home
│   │   ├── About
│   │   ├── Contact
│   ├── utils
│   ├── store
│   │   ├── atoms
│   │   │   ├── globalAtoms.ts
│   │   ├── context
│   │   │   ├── GlobalContext.tsx
│   ├── modules
│   │   ├── Module1
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── Module1UIElement.tsx
│   │   │   ├── store
│   │   │   │   ├── atoms
│   │   │   │   │   ├── moduleAtoms.ts
│   │   │   ├── context
│   │   │   │   ├── ModuleContext.tsx
│   │   │   ├── components
│   │   │   │   ├── ModuleComponent1
│   │   │   │   │   ├── assets
│   │   │   │   │   │   ├── constants.ts
│   │   │   │   │   │   ├── utils.ts
│   │   │   │   │   │   ├── ModuleComponent1UIElement.tsx
│   │   │   │   │   ├── Component.tsx
│   │   │   │   │   ├── hooks
│   │   │   │   │   │   ├── useModuleComponent1Hook.ts
│   │   │   │   │   │   ├── types.d.ts
│   │   │   │   ├── ModuleComponent2.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useModuleHook1.ts
│   │   │   │   ├── useModuleHook2.ts
│   │   │   ├── Module.tsx
│   │   │   ├── types.d.ts
│   │   ├── Module2
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── utils.ts
│   │   │   │   ├── Module2UIElement.tsx
│   │   ├── components
│   │   │   ├── ModuleComponent1.tsx
│   ├── hooks
│   │   │   ├── useModuleHook1.ts
│   ├── Module.tsx
│   ├── types.d.ts
│   └── global.d.ts
├── EE
│   ├── assets
│   │   ├── constants.ts
│   │   ├── utils.ts
│   │   ├── UIElement1.tsx
│   ├── components
│   │   ├── Component1
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── utils.ts
│   │   │   │   ├── Component1UIElement.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useComponent1Hook.ts
│   │   │   │   ├── types.d.ts
│   │   ├── Component.tsx
│   ├── hooks
│   │   ├── useSharedHook1.ts
│   │   ├── useSharedHook2.ts
│   ├── pages
│   │   ├── EEPage
│   ├── utils
│   ├── store
│   │   ├── atoms
│   │   │   ├── eeAtoms.ts
│   │   ├── context
│   │   │   ├── EEContext.tsx
│   ├── modules
│   │   ├── Module1
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── Module1UIElement.tsx
│   │   │   ├── store
│   │   │   │   ├── atoms
│   │   │   │   │   ├── moduleAtoms.ts
│   │   │   ├── context
│   │   │   │   ├── ModuleContext.tsx
│   │   │   ├── components
│   │   │   │   ├── ModuleComponent1
│   │   │   │   │   ├── assets
│   │   │   │   │   │   ├── constants.ts
│   │   │   │   │   │   ├── utils.ts
│   │   │   │   │   │   ├── ModuleComponent1UIElement.tsx
│   │   │   │   │   ├── Component.tsx
│   │   │   │   │   ├── hooks
│   │   │   │   │   │   ├── useModuleComponent1Hook.ts
│   │   │   │   │   │   ├── types.d.ts
│   │   │   │   ├── ModuleComponent2.tsx
│   │   │   ├── hooks
│   │   │   │   ├── useModuleHook1.ts
│   │   │   │   ├── useModuleHook2.ts
│   │   │   ├── Module.tsx
│   │   │   ├── types.d.ts
│   │   ├── Module2
│   │   │   ├── assets
│   │   │   │   ├── constants.ts
│   │   │   │   ├── utils.ts
│   │   │   │   ├── Module2UIElement.tsx
│   │   ├── components
│   │   │   ├── ModuleComponent1.tsx
│   ├── hooks
│   │   │   ├── useModuleHook1.ts
│   ├── Module.tsx
│   ├── types.d.ts
│   └── global.d.ts
```

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
        - UI-only subcomponents (`assets/*.tsx`)
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
        - Context providers for complex state/dependency injection
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
    - Prefer Jotai atoms for simple reactive state
    - Use Context for complex state with multiple consumers
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

### Data Fetching Best Practices

We recommend using SWR with Axios for data fetching instead of useEffect patterns. This helps achieve cleaner code while,

-   simplifying management of fetch states.
-   handling cache better
-   having a more interactive UI by revalidating in background
-   utilizing optimistic mutations.

#### Example: Converting useEffect Data Fetching to SWR with Axios

❌ **Avoid this pattern:**

```javascript
useEffect(() => {
    fetchData1()
        .then((data1) => {
            setData1(data1)
        })
        .catch((error) => {
            setError1(error)
        })

    fetchData2()
        .then((data2) => {
            setData2(data2)
        })
        .catch((error) => {
            setError2(error)
        })
}, [])
```

✅ **Use this pattern:**

We configure SWR globally with our pre-configured Axios instance:

```javascript
// src/utils/swrConfig.js
import axios from "@/lib/helpers/axios"
import useSWR from "swr"

const fetcher = (url) => axios.get(url).then((res) => res.data)

export const swrConfig = {
    fetcher,
}
```

To ensure SWR configuration is applied globally, wrap your application with SWRConfig in `_app.tsx`:

```javascript
// src/pages/_app.tsx
import {SWRConfig} from "swr"
import {swrConfig} from "../utils/swrConfig"

function MyApp({Component, pageProps}) {
    return (
        <SWRConfig value={swrConfig}>
            <Component {...pageProps} />
        </SWRConfig>
    )
}

export default MyApp
```

and data can be then be fetched in a way that fits react mental model inside the component:

```javascript
import useSWR from "swr"

function Component() {
    const {data: data1, error: error1, loading: loadingData1} = useSWR("/api/data1")
    const {data: data2, error: error2, loading: loadingData2} = useSWR("/api/data2")

    if (error1 || error2) return <div>Error loading data</div>
    if (!data1 || !data2) return <div>Loading...</div>

    return (
        <div>
            <div>Data 1: {data1}</div>
            <div>Data 2: {data2}</div>
        </div>
    )
}
```

Mutations can be triggered via Swr in the following way

```javascript
import useSWRMutation from 'swr/mutation'

async function sendRequest(url, { arg }: { arg: { username: string }}) {
  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(arg)
  }).then(res => res.json())
}

function App() {
  const { trigger, isMutating } = useSWRMutation('/api/user', sendRequest, /* options */)

  return (
    <button
      disabled={isMutating}
      onClick={async () => {
        try {
          const result = await trigger({ username: 'johndoe' }, /* options */)
        } catch (e) {
          // error handling
        }
      }}
    >
      Create User
    </button>
  )
}
```

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

;<AccordionTreePanel items={items} />
```
