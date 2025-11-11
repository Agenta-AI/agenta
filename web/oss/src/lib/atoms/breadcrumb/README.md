# Breadcrumb System

A flexible, atom-based breadcrumb system that provides both automatic URL-based breadcrumbs and custom breadcrumb control.

## Overview

The breadcrumb system uses Jotai atoms to manage breadcrumb state, allowing pages and components to override the default URL-based breadcrumbs with custom, contextual navigation paths.

## Key Features

- **Hybrid Approach**: Falls back to URL-based breadcrumbs when no custom breadcrumbs are set
- **Full Backward Compatibility**: Existing pages continue working without changes
- **Flexible Control**: Pages can set static or dynamic breadcrumbs
- **Component Integration**: Child components can append to existing breadcrumbs
- **Automatic Cleanup**: Breadcrumbs reset to URL-based when components unmount
- **Icon Support**: Breadcrumb items can include icons
- **Link Support**: Items can be clickable links or plain text
- **Disabled State**: Items can be disabled for conditional navigation

## API Reference

### BreadcrumbItem Interface

```typescript
interface BreadcrumbItem {
    label: string          // Display text
    href?: string         // Optional link URL
    icon?: ReactNode      // Optional icon component
    disabled?: boolean    // Optional disabled state
    menu?: BreadcrumbAtom // Optional menu items
    value?: string        // Optional value for dynamic(especially useful for uuids) 
}
```

### Hooks

#### `useBreadcrumbs()`

Returns breadcrumb control functions:

```typescript
const {
    setBreadcrumbs,      // Set complete breadcrumb array
    appendBreadcrumb,    // Add item to end
    prependBreadcrumb,   // Add item to beginning
    clearBreadcrumbs     // Reset to URL-based
} = useBreadcrumbs()
```

#### `useBreadcrumbsEffect({breadcrumbs, type, condition}, deps?)`

Sets breadcrumbs and automatically clears them on component unmount:

```typescript
useBreadcrumbsEffect({
    breadcrumbs: [
        {label: "Home", href: "/"},
        {label: "Settings"}
    ],
    type: "new",
    condition: true
}, [dependency])
```

## Usage Examples

### 1. Simple Static Breadcrumbs

```typescript
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {Settings} from "@phosphor-icons/react"

export const SettingsPage = () => {
    const breadcrumbs = [
        {label: "Home", href: "/"},
        {label: "Settings", icon: <Settings size={16} />},
    ]

    useBreadcrumbsEffect({breadcrumbs}, [])

    return <div>Settings Page Content</div>
}
```

### 2. Dynamic Breadcrumbs Based on Data

```typescript
import {useEffect, useState} from "react"
import {useBreadcrumbs} from "@/oss/lib/hooks/useBreadcrumbs"
import {Users} from "@phosphor-icons/react"

export const UserProfilePage = ({userId}: {userId: string}) => {
    const [userName, setUserName] = useState<string>("")
    const {setBreadcrumbs} = useBreadcrumbs()

    useEffect(() => {
        const fetchUser = async () => {
            const user = await api.getUser(userId)
            setUserName(user.name)

            setBreadcrumbs([
                {label: "Home", href: "/"},
                {label: "Users", href: "/users", icon: <Users size={16} />},
                {label: user.name},
            ])
        }

        fetchUser()
    }, [userId, setBreadcrumbs])

    return <div>User Profile for {userName}</div>
}
```

### 3. Child Component Appending Breadcrumbs

```typescript
import {useEffect} from "react"
import {useBreadcrumbs} from "@/oss/lib/hooks/useBreadcrumbs"
import {TestTube} from "@phosphor-icons/react"

export const TestResultsTab = ({testId}: {testId: string}) => {
    const {appendBreadcrumb} = useBreadcrumbs()

    useEffect(() => {
        appendBreadcrumb({
            label: "Test Results",
            icon: <TestTube size={16} />,
        })
    }, [testId, appendBreadcrumb])

    return <div>Test Results Content</div>
}
```

### 4. Conditional Breadcrumbs

```typescript
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"

export const AdminDashboard = ({hasPermission}: {hasPermission: boolean}) => {
    const breadcrumbs = [
        {label: "Home", href: "/"},
        {
            label: "Admin", 
            href: hasPermission ? "/admin" : undefined, 
            disabled: !hasPermission
        },
        ...(hasPermission ? [{label: "Dashboard"}] : []),
    ]

    useBreadcrumbsEffect(breadcrumbs, [hasPermission])

    return <div>Admin Dashboard</div>
}
```

### 5. Manual Control

```typescript
import {useBreadcrumbs} from "@/oss/lib/hooks/useBreadcrumbs"

export const CustomControlPage = () => {
    const {setBreadcrumbs, clearBreadcrumbs} = useBreadcrumbs()

    const handleSetCustomBreadcrumbs = () => {
        setBreadcrumbs([
            {label: "Custom", href: "/custom"},
            {label: "Manual Control"},
        ])
    }

    const handleResetToUrlBased = () => {
        clearBreadcrumbs() // Falls back to URL-based breadcrumbs
    }

    return (
        <div>
            <button onClick={handleSetCustomBreadcrumbs}>
                Set Custom Breadcrumbs
            </button>
            <button onClick={handleResetToUrlBased}>
                Reset to URL-based
            </button>
        </div>
    )
}
```

## Migration Guide

### For Existing Pages

No changes required! Pages will continue using URL-based breadcrumbs automatically.

### For New Pages Needing Custom Breadcrumbs

1. Import the hook: `import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"`
2. Define your breadcrumbs array
3. Call `useBreadcrumbsEffect(breadcrumbs)` in your component

### For Dynamic Breadcrumbs

1. Use `useBreadcrumbs()` hook for manual control
2. Call `setBreadcrumbs()` when data loads
3. Breadcrumbs will automatically reset when the component unmounts

## Best Practices

- Use `useBreadcrumbsEffect()` for simple static or dependency-based breadcrumbs
- Use `useBreadcrumbs()` for complex dynamic scenarios
- Include icons for better visual hierarchy
- Make intermediate breadcrumbs clickable with `href` when appropriate
- Use the `disabled` prop for conditional navigation states
- Keep breadcrumb labels concise and meaningful
