# Environment Entity

This module provides state management for **environment** entities using the molecule architecture. It uses the new git-based **SimpleEnvironment API** which abstracts the 3-level artifact/variant/revision hierarchy into a simpler frontend-facing model.

## Overview

```text
environment/
├── index.ts              # Public exports
├── README.md             # This file
├── core/                 # Schemas and types
│   ├── schema.ts         # Zod schemas
│   ├── types.ts          # TypeScript interfaces
│   └── index.ts          # Re-exports
├── api/                  # HTTP functions
│   ├── api.ts            # Fetch functions
│   ├── mutations.ts      # Mutation functions (CRUD, deploy, guard)
│   └── index.ts          # Re-exports
└── state/                # State management
    ├── store.ts          # Query atom families
    ├── environmentMolecule.ts
    └── index.ts          # Re-exports
```

## Quick Start

### Using the Molecule API

```typescript
import { environmentMolecule } from '@agenta/entities/environment'

// In components - use atoms directly
function EnvironmentCard({ envId }: { envId: string }) {
  const data = useAtomValue(environmentMolecule.data(envId))
  const isDirty = useAtomValue(environmentMolecule.isDirty(envId))

  if (!data) return <Skeleton />

  return (
    <div>
      <h2>{data.name}</h2>
      <p>{data.description}</p>
      {data.flags?.is_guarded && <Badge>Guarded</Badge>}
      {isDirty && <span>Unsaved changes</span>}
    </div>
  )
}
```

### Using Atoms in Jotai

```typescript
import { environmentMolecule } from '@agenta/entities/environment'

// Subscribe to specific state
const data = useAtomValue(environmentMolecule.data(envId))
const isDirty = useAtomValue(environmentMolecule.isDirty(envId))

// Null-safe access (when ID may be undefined)
const query = useAtomValue(environmentMolecule.queryOptional(envId ?? null))
const data = useAtomValue(environmentMolecule.dataOptional(envId ?? null))
```

### Imperative API (in callbacks)

```typescript
import { environmentMolecule } from '@agenta/entities/environment'

// Read state
const data = environmentMolecule.get.data(envId)
const isDirty = environmentMolecule.get.isDirty(envId)

// Lookup by slug
const production = environmentMolecule.get.bySlug('production')

// Write state
environmentMolecule.set.update(envId, { name: 'Staging' })
environmentMolecule.set.discard(envId)
```

## Molecule API

### `environmentMolecule`

Manages environment entity state with deployment and guard operations.

#### Top-Level Atoms

| Atom | Description |
|------|-------------|
| `.data(id)` | Merged data (server + draft) |
| `.query(id)` | Query state (isPending, isError, error) |
| `.isDirty(id)` | Has unsaved changes |
| `.queryOptional(id \| null)` | Null-safe query (returns empty state for null) |
| `.dataOptional(id \| null)` | Null-safe data (returns null atom for null) |

#### Atoms Namespace

| Atom | Description |
|------|-------------|
| `.atoms.data(id)` | Merged data (server + draft) |
| `.atoms.serverData(id)` | Server data only |
| `.atoms.draft(id)` | Local draft changes |
| `.atoms.query(id)` | Query state |
| `.atoms.isDirty(id)` | Has unsaved changes |
| `.atoms.isNew(id)` | Is new entity |
| `.atoms.list(includeArchived)` | Environments list query |

#### Actions Namespace

| Action | Params | Description |
|--------|--------|-------------|
| `.actions.update` | `(id, changes)` | Update environment draft |
| `.actions.discard` | `(id)` | Discard environment draft |
| `.actions.archive` | `{ projectId, environmentIds }` | Archive environments |
| `.actions.toggleGuard` | `{ projectId, environmentId, guard }` | Guard/unguard environment |
| `.actions.commit` | `EnvironmentRevisionCommitParams` | Commit an environment revision |
| `.actions.deploy` | `DeployToEnvironmentParams` | Deploy an app revision to environment |

#### Imperative API

```typescript
// Getters
environmentMolecule.get.data(id)        // => Environment | null
environmentMolecule.get.serverData(id)  // => Environment | null
environmentMolecule.get.isDirty(id)     // => boolean
environmentMolecule.get.bySlug(slug)    // => Environment | null

// Setters
environmentMolecule.set.update(id, { name: 'Production' })
environmentMolecule.set.discard(id)
```

#### Selectors Namespace

| Selector | Description |
|----------|-------------|
| `.selectors.query(id)` | Query state atom |
| `.selectors.queryOptional(id \| null)` | Null-safe query atom |
| `.selectors.data(id)` | Merged data atom |
| `.selectors.dataOptional(id \| null)` | Null-safe data atom |
| `.selectors.serverData(id)` | Server data atom |
| `.selectors.draft(id)` | Draft atom |
| `.selectors.isDirty(id)` | Dirty state atom |

#### Revisions List

```typescript
// Enable revisions list for an environment
set(environmentMolecule.revisionsList.reducers.enable, { environmentId, projectId })

// Read revisions list
const revisions = useAtomValue(environmentMolecule.revisionsList.atoms.query(environmentId))
```

## Cache Invalidation

After mutations, invalidate caches to refresh data:

```typescript
import {
  invalidateEnvironmentsListCache,
  invalidateEnvironmentCache,
  invalidateEnvironmentRevisionsListCache,
} from '@agenta/entities/environment'

// After creating/archiving an environment
invalidateEnvironmentsListCache()

// After updating environment metadata
invalidateEnvironmentCache(environmentId)

// After committing a new revision
invalidateEnvironmentRevisionsListCache(environmentId)
```

> **Note:** The molecule actions (`archive`, `toggleGuard`, `commit`, `deploy`) automatically invalidate relevant caches after successful mutations.

## Schemas

### Environment Schema (SimpleEnvironment)

```typescript
import { environmentSchema, type Environment } from '@agenta/entities/environment'

const env = environmentSchema.parse(apiResponse)

// Type
interface Environment {
  id: string
  slug?: string | null
  name?: string | null
  description?: string | null
  flags?: { is_guarded: boolean } | null
  data?: EnvironmentRevisionData | null
  variant_id?: string | null
  revision_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}
```

### Environment Revision Schema

```typescript
import { environmentRevisionSchema, type EnvironmentRevision } from '@agenta/entities/environment'

// Type
interface EnvironmentRevision {
  id: string
  environment_id?: string | null
  environment_variant_id?: string | null
  name?: string | null
  description?: string | null
  slug?: string | null
  version?: number | null       // Parsed from string to number
  author?: string | null
  message?: string | null
  data?: EnvironmentRevisionData | null
  created_at?: string | null
  updated_at?: string | null
}
```

### Environment Revision Data

The `data` field on environments and revisions contains a `references` map that tracks which app revisions are deployed:

```typescript
import { type EnvironmentRevisionData, type Reference } from '@agenta/entities/environment'

// Structure
interface EnvironmentRevisionData {
  references?: Record<string, Record<string, Reference>> | null
}

interface Reference {
  id?: string | null
  slug?: string | null
  version?: string | null
}

// Example data
const data: EnvironmentRevisionData = {
  references: {
    "myapp.default": {
      application: { id: "app-uuid", slug: "myapp" },
      application_variant: { id: "variant-uuid", slug: "default" },
      application_revision: { id: "rev-uuid", slug: "...", version: "3" },
    },
  },
}
```

## API Functions

For direct API access without caching:

```typescript
import {
  fetchEnvironmentsList,
  fetchEnvironmentDetail,
  fetchEnvironmentRevisionsList,
  fetchLatestEnvironmentRevision,
  fetchEnvironmentsBatch,
} from '@agenta/entities/environment'

// Fetch all environments
const { environments, count } = await fetchEnvironmentsList({ projectId })

// Fetch single environment
const env = await fetchEnvironmentDetail({ id: envId, projectId })

// Fetch revision history
const { environment_revisions } = await fetchEnvironmentRevisionsList({
  projectId,
  environmentId,
})

// Fetch latest revision (optimized - limit 1)
const latest = await fetchLatestEnvironmentRevision({ projectId, environmentId })

// Batch fetch environments by IDs
const envMap = await fetchEnvironmentsBatch(projectId, environmentIds)
// Returns: Map<environmentId, Environment>
```

### Mutation Functions

```typescript
import {
  createEnvironment,
  editEnvironment,
  archiveEnvironment,
  unarchiveEnvironment,
  guardEnvironment,
  unguardEnvironment,
  commitEnvironmentRevision,
  deployToEnvironment,
  undeployFromEnvironment,
} from '@agenta/entities/environment'

// Create a new environment
const env = await createEnvironment({
  projectId,
  slug: 'staging',
  name: 'Staging',
  description: 'Staging environment',
})

// Edit environment metadata
await editEnvironment({
  projectId,
  environmentId: env.id,
  name: 'Staging (Updated)',
})

// Guard/unguard
await guardEnvironment(projectId, envId)
await unguardEnvironment(projectId, envId)

// Archive/unarchive
await archiveEnvironment(projectId, envId)
await unarchiveEnvironment(projectId, envId)
```

### Deploying App Revisions

The primary use case for environments is deploying app revisions:

```typescript
import { deployToEnvironment, undeployFromEnvironment } from '@agenta/entities/environment'

// Deploy an app revision
await deployToEnvironment({
  projectId,
  environmentId,
  environmentVariantId,
  appKey: 'myapp.default',
  references: {
    application: { id: appId, slug: 'myapp' },
    application_variant: { id: variantId, slug: 'default' },
    application_revision: { id: revisionId, version: '3' },
  },
  message: 'Deploy v3 to staging',
})

// Remove an app deployment
await undeployFromEnvironment(
  projectId,
  environmentId,
  environmentVariantId,
  'myapp.default',
  'Undeploy myapp from staging',
)
```

For more control, use `commitEnvironmentRevision` directly with delta operations:

```typescript
import { commitEnvironmentRevision } from '@agenta/entities/environment'

// Add/update multiple app deployments in one commit
await commitEnvironmentRevision({
  projectId,
  environmentId,
  environmentVariantId,
  delta: {
    set: {
      'app1.default': {
        application: { id: 'app1-id' },
        application_variant: { id: 'variant1-id' },
        application_revision: { id: 'rev1-id', version: '2' },
      },
      'app2.default': {
        application: { id: 'app2-id' },
        application_variant: { id: 'variant2-id' },
        application_revision: { id: 'rev2-id', version: '5' },
      },
    },
    remove: ['old-app.default'],
  },
  message: 'Multi-app deployment update',
})
```

## Utilities

```typescript
import {
  getDeployedRevisionId,
  getDeployedAppKeys,
  isGuardedEnvironment,
  normalizeEnvironment,
  normalizeEnvironmentRevision,
} from '@agenta/entities/environment'

// Get deployed revision ID for an app
const revId = getDeployedRevisionId(env.data, 'myapp.default')

// Get all deployed app keys
const appKeys = getDeployedAppKeys(env.data)
// => ['myapp.default', 'otherapp.default']

// Check if environment is guarded
isGuardedEnvironment(env) // => true/false

// Normalize API responses
const env = normalizeEnvironment(rawApiData)
const rev = normalizeEnvironmentRevision(rawRevisionData)
```

## Architecture Notes

### Entity Model

```text
Environment (SimpleEnvironment)
├── name, slug, description
├── flags (is_guarded)
└── data.references (deployed app revisions)
    ├── "app1.default" → { application, application_variant, application_revision }
    └── "app2.default" → { application, application_variant, application_revision }
```

### Backend Abstraction

The backend uses a 3-level git-based model:

```text
Environment (Artifact) → EnvironmentVariant → EnvironmentRevision
```

The **SimpleEnvironment API** abstracts this into a flat model for the frontend. The `variant_id` and `revision_id` fields on `Environment` are internal IDs from the git layer, used when committing revisions.

### Revision Commit Model

Environment changes are tracked through immutable revisions. Each commit can use:

- **Full data snapshot** (`data`): Replaces all references
- **Delta operations** (`delta`): Incremental changes
  - `set`: Add or update reference entries
  - `remove`: Remove reference entries by key

### Guard Protection

Guarded environments (`is_guarded: true`) require explicit approval before deployments. The `guardEnvironment` / `unguardEnvironment` mutations toggle this flag.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/preview/simple/environments/query` | List/query environments |
| `POST` | `/preview/simple/environments/` | Create environment |
| `PUT` | `/preview/simple/environments/{id}` | Edit environment |
| `POST` | `/preview/simple/environments/{id}/archive` | Archive |
| `POST` | `/preview/simple/environments/{id}/unarchive` | Unarchive |
| `POST` | `/preview/simple/environments/{id}/guard` | Guard |
| `POST` | `/preview/simple/environments/{id}/unguard` | Unguard |
| `POST` | `/preview/environments/revisions/query` | Query revisions |
| `POST` | `/preview/environments/revisions/commit` | Commit revision |
