# @agenta/shared

Shared utilities and primitives for Agenta packages and apps.

## Installation

This is an internal workspace package. Add it to your package's dependencies:

```json
{
  "dependencies": {
    "@agenta/shared": "workspace:*"
  }
}
```

## Peer Dependencies

This package requires the following peer dependencies:

- `axios` >= 1.0.0
- `jotai` >= 2.0.0
- `jotai-tanstack-query` >= 0.9.0
- `@tanstack/react-query` >= 5.0.0

## Usage

### API Utilities

```typescript
import { axios, getAgentaApiUrl, getEnv, configureAxios } from '@agenta/shared'

// Get environment variables (supports runtime override via window.__env)
const apiUrl = getEnv('NEXT_PUBLIC_AGENTA_API_URL')

// Use the shared axios instance
const response = await axios.get('/api/endpoint')

// Configure axios interceptors at app startup
configureAxios({
  requestInterceptor: async (config) => {
    const jwt = await getJWT()
    if (jwt) config.headers.set('Authorization', `Bearer ${jwt}`)
    return config
  },
  errorInterceptor: (error) => {
    if (error.response?.status === 401) signOut()
    throw error
  }
})
```

### State Atoms

```typescript
import { projectIdAtom, setProjectIdAtom } from '@agenta/shared'
import { useAtom, useSetAtom } from 'jotai'

// Read project ID
const [projectId] = useAtom(projectIdAtom)

// Set project ID
const setProjectId = useSetAtom(setProjectIdAtom)
setProjectId('my-project-id')
```

### Validation Utilities

```typescript
import { isValidHttpUrl, isValidRegex, isValidUUID, validateUUID } from '@agenta/shared'

isValidHttpUrl('https://example.com') // true
isValidRegex('^[a-z]+$') // true
isValidUUID('550e8400-e29b-41d4-a716-446655440000') // true

// Throws if invalid
validateUUID(id, 'projectId')
```

### Date/Time Utilities

```typescript
import { dayjs, parseEntityDate, normalizeTimestamps } from '@agenta/shared'

// Parse dates with WebKit-compatible fallback formats
const date = parseEntityDate('2024-01-15T10:30:00.000000Z')

// Normalize timestamps in entity data
const entity = normalizeTimestamps({ created_at: '2024-01-15T10:30:00Z', name: 'Test' })
// { created_at: Date, name: 'Test' }

// Use dayjs directly (with customParseFormat and utc plugins)
dayjs('2024-01-15').format('YYYY-MM-DD')
```

### Batch Fetcher

```typescript
import { createBatchFetcher } from '@agenta/shared'

const fetchUser = createBatchFetcher({
  batchFn: async (ids) => {
    const users = await api.getUsers(ids)
    return new Map(users.map(u => [u.id, u]))
  },
  flushDelay: 50,
  maxBatchSize: 100,
})

// Individual calls are batched automatically
const user1 = await fetchUser('id-1')
const user2 = await fetchUser('id-2')
```

### Path Utilities

Navigate and manipulate nested data structures:

```typescript
import {
  getValueAtPath,
  setValueAtPath,
  deleteValueAtPath,
  parsePath,
  pathToString,
} from '@agenta/shared'

const data = { user: { profile: { name: 'Alice' } } }

// Get nested value
getValueAtPath(data, ['user', 'profile', 'name']) // 'Alice'

// Set nested value (immutable)
const updated = setValueAtPath(data, ['user', 'profile', 'name'], 'Bob')
// { user: { profile: { name: 'Bob' } } }

// Parse path strings
parsePath('user.profile.name') // ['user', 'profile', 'name']
parsePath('items[0].name') // ['items', '0', 'name']

// Handles JSON strings in data
const testcase = { messages: '{"content": "hello"}' }
getValueAtPath(testcase, ['messages', 'content']) // 'hello'
```

## Subpath Exports

Import from specific subpaths for tree-shaking:

```typescript
import { axios, getEnv } from '@agenta/shared/api'
import { projectIdAtom } from '@agenta/shared/state'
import { isValidUUID, createBatchFetcher, dayjs } from '@agenta/shared/utils'
```

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```
