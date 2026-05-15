# @agenta/sdk

The TypeScript SDK for [Agenta](https://agenta.ai) — manage prompts, run evaluations, and query traces from Node.js apps.

> **Status: alpha (v0.1.x).** This package is internal-only at the moment. v0.2.0-alpha.0 is the first npm release; see [`PARITY.md`](./PARITY.md) for what's covered and what's deferred.

## Install

```sh
# Internal (current, while v0.1.x is unpublished):
# Already in workspace — import directly.

# After v0.2.0-alpha.0 lands on npm:
pnpm add @agenta/sdk zod
# yaml is optional; install only if you load YAML config files
pnpm add yaml
```

Required peer dep: `zod >= 3`. Optional peer dep: `yaml >= 2` (only needed if you call `loadFromYaml`).

## Initialize

```ts
import {Agenta} from "@agenta/sdk"

const ag = new Agenta({
    host: "https://cloud.agenta.ai",
    apiKey: process.env.AGENTA_API_KEY,
    projectId: process.env.AGENTA_PROJECT_ID,
})
```

Configuration sources (priority order, highest first):

1. Constructor args
2. `AGENTA_HOST`, `AGENTA_API_KEY`, `AGENTA_PROJECT_ID` env vars
3. `NEXT_PUBLIC_AGENTA_*` env vars
4. Defaults: `host = "http://localhost"`, `basePath = "/api"`

For dynamic auth (JWT refresh, custom auth providers), pass `authProvider`:

```ts
const ag = new Agenta({
    authProvider: async () => {
        const jwt = await getJwt()
        return jwt ? `Bearer ${jwt}` : undefined
    },
})
```

## Quick start: fetch a prompt

The most common SDK flow. Pull a prompt from Agenta's registry, optionally interpolate template variables, and use it with your LLM client.

```ts
const result = await ag.prompts.fetch({
    slugs: ["customer-support-system"],
    environment: "production",
    fallbacks: {
        "customer-support-system": "You are a helpful assistant.",
    },
})

console.log(result.instructions) // composed prompt string
console.log(result.toolSchemas) // function-tool schemas, if any
console.log(result.applicationId, result.revisionId) // for trace tagging
```

The `fetchOne` shorthand handles single-slug fetches:

```ts
const {content, revisionId} = await ag.prompts.fetchOne("customer-support-system", {
    environment: "production",
    fallback: "You are a helpful assistant.",
})
```

## Push a variant

Create or update a prompt application, commit a new revision, deploy to an environment.

```ts
await ag.prompts.push({
    slug: "customer-support-system",
    name: "Customer Support System Prompt",
    content: "You are a helpful customer support agent. Be concise.",
    environment: "production",
    model: "openai/gpt-4o-mini",
})
```

For more granular control, use the underlying resources directly:

```ts
const app = await ag.applications.create({
    slug: "my-prompt",
    name: "My Prompt",
    flags: {is_application: true, is_chat: true},
    data: {
        /* parameters, schemas */
    },
})

await ag.revisions.commit({
    application_revision: {
        application_id: app.application!.id!,
        data: {
            /* updated parameters */
        },
        message: "Tighten the system prompt",
    },
})

await ag.environments.deploy({
    environmentId: "...",
    appId: app.application!.id!,
    appRevisionId: "...",
    message: "Deploy v2",
})
```

## Run an evaluation

Create a test set, register an evaluator, run a batch, query the results.

```ts
// 1. Create a test set
const testset = await ag.testsets.create({
    slug: "support-cases",
    name: "Support Cases",
    testcases: [
        {input: "How do I reset my password?", expected: "Use the forgot-password link"},
        {input: "What's your refund policy?", expected: "30-day full refund"},
    ],
})

// 2. Use an existing evaluator (or create one via ag.evaluators.create(...))
const evaluator = await ag.evaluators.findBySlug("exact-match")

// 3. Kick off a run
const run = await ag.evaluations.createRuns({
    runs: [
        {
            testset_id: testset.id!,
            evaluator_id: evaluator!.id!,
            // ... application revision ref, etc.
        },
    ],
})

// 4. Query results
const results = await ag.evaluations.queryResults({
    run_ids: [run.runs[0].id!],
})

// 5. Compare runs (optional)
const comparison = await ag.evaluations.compareRuns({
    run_ids: ["run-1", "run-2"],
})
```

## Query traces

```ts
// All spans for an application
const spans = await ag.tracing.queryByApplication("app-id-123", {
    windowing: {limit: 50},
})

// Custom filtering
const errored = await ag.tracing.querySpans({
    filtering: {
        conditions: [
            {field: "ATTRIBUTES", key: "error", value: true, operator: "eq"},
        ],
    },
    windowing: {limit: 100, order: "descending"},
})

// Aggregate analytics
const dailyStats = await ag.tracing.queryAnalytics({granularity: "day"})
```

## Annotate a trace

Attach feedback / scores to a trace span. Used for human-in-the-loop evaluation and online quality monitoring.

```ts
await ag.annotations.create({
    annotation: {
        trace_id: "trace-abc",
        span_id: "span-xyz",
        rating: 4,
        comment: "Good response, but a bit terse",
        evaluator_slug: "human-rating",
    },
})
```

## File-based configuration

Mirrors Python's `ag.ConfigManager.get_from_yaml` / `get_from_json`.

```ts
import {z} from "zod"
import {loadFromJson, loadFromYaml} from "@agenta/sdk"

// Without validation (returns parsed object as `unknown`)
const raw = await loadFromJson("./config.json")

// With Zod schema validation (type-safe)
const Config = z.object({
    apiKey: z.string(),
    host: z.string().url(),
    timeoutMs: z.number().int().positive(),
})
const config = await loadFromYaml("./config.yaml", Config)
config.apiKey // typed as string
```

YAML support requires `yaml` as a peer dep (`pnpm add yaml`). The error message tells you exactly what to install if it's missing.

## Error handling

Every typed error extends `AgentaApiError`. Use `instanceof` checks for backward compat or narrow on the specific subclass:

```ts
import {
    AgentaApiError,
    AgentaAuthError,
    AgentaNotFoundError,
    AgentaRateLimitError,
    AgentaServerError,
    AgentaValidationError,
} from "@agenta/sdk"

try {
    await ag.prompts.fetch({slugs: ["unknown"]})
} catch (err) {
    if (err instanceof AgentaAuthError) {
        // 401 / 403 — refresh JWT, prompt sign-in, etc.
    } else if (err instanceof AgentaNotFoundError) {
        // 404 — prompt slug doesn't exist; fall back to local default
    } else if (err instanceof AgentaRateLimitError) {
        // 429 — back off; err.retryAfterMs is parsed from Retry-After
        await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 5000))
    } else if (err instanceof AgentaServerError) {
        // 5xx — already retried 3x with exponential backoff before throwing
    } else if (err instanceof AgentaValidationError) {
        // 400 / 422 — fix request payload
    } else if (err instanceof AgentaApiError) {
        // Other status codes (e.g., 418)
    }
    throw err
}
```

## Retries and timeouts

The client retries network errors, 5xx responses, and 429 with exponential backoff + full jitter. Configuration:

```ts
const ag = new Agenta({
    retries: 5, // total attempts including the first; default 3
    retryBackoffMs: 500, // base delay in ms; default 200
    timeout: 60_000, // per-request timeout; default 30s
})
```

429 honors the `Retry-After` header (seconds or HTTP-date), capped at 60s. Set `retries: 1` to disable retries entirely.

## Resources

The full SDK surface, organized by resource:

| Resource | Common operations |
|---|---|
| `prompts` | `fetch`, `fetchOne`, `push`, `pushMany`, `getApplicationRefs`, `clearCache` |
| `applications` | `query`, `list`, `get`, `create`, `update`, `archive`, `unarchive`, `archiveVariant`, `unarchiveVariant`, `findBySlug` |
| `revisions` | `retrieve`, `retrieveBySlug`, `retrieveByAppId`, `commit`, `log` |
| `environments` | `list`, `resolve`, `deploy`, `ensureExists`, ... |
| `evaluators` | `query`, `list`, `get`, `create`, `update`, `archive`, `unarchive`, `transfer`, `getRevision`, `archiveRevision`, `unarchiveRevision`, `logRevisions`, `queryRevisions`, `commitRevision`, `retrieveRevision`, `createVariant`, `getVariant`, `archiveVariant`, `unarchiveVariant`, `forkVariant`, `queryVariants`, `listTemplates`, `getTemplate`, `listPresets`, `findBySlug` |
| `evaluations` | `createRuns`, `queryRuns`, `getRun`, `editRuns`, `closeRun`, `openRun`, `queryScenarios`, `queryResults`, `queryMetrics`, `compareRuns`, `refreshMetrics`, `refreshRuns`, `createSimple`, ... |
| `testsets` | `create`, `get`, `query`, `list`, `update`, `archive`, `unarchive`, `transfer`, `commitRevision`, `queryRevisions`, `getRevision`, `archiveRevision`, `unarchiveRevision`, `logRevisions`, `retrieveRevision`, `createVariant`, `archiveVariant`, `unarchiveVariant`, `queryVariants`, `upload`, `download`, `findBySlug`, `createFromTraces` |
| `testcases` | `create`, `query` |
| `queries` | `create`, `get`, `update`, `archive`, `unarchive`, `query`, `commitRevision`, `getRevision`, `archiveRevision`, `unarchiveRevision`, `logRevisions`, `queryRevisions`, `retrieveRevision`, `createSimple`, `getSimple`, `archiveSimple`, `unarchiveSimple`, `querySimple` |
| `workflows` | `query`, `list*`, `create`, `edit`, `update`, `archive`, `unarchive`, `inspect`, `invoke`, `commitRevision`, `queryRevisions`, `retrieveRevision`, `logRevisions`, `getRevision`, `archiveRevision`, `unarchiveRevision`, `createVariant`, `getVariant`, `forkVariant`, `archiveVariant`, `unarchiveVariant`, `queryVariants`, `listTemplates`, `fetchInterfaceSchemas`, `fetchLatest`, `findBySlug` |
| `annotations` | `create`, `getByTrace`, `editByTrace`, `deleteByTrace`, `query`, `getForTraces`, `createHumanFeedback` |
| `tracing` | `querySpans`, `queryTraces`, `queryByApplication`, `getTrace`, `getSpan`, `deleteTrace`, `querySessions`, `queryUsers`, `queryAnalytics`, `spanAnalytics` |
| `vault` | `list`, `get`, `create`, `update`, `delete` |
| `apiKeys` | `list`, `create`, `delete` |
| `profile` | `get`, `getOrganizations` |
| `projects`, `folders`, `organizations`, `workspaces` | CRUD |

Most resources follow a consistent shape: `query(filters)` for searching, `get(id)` for single fetch, `archive`/`unarchive` for soft-delete lifecycle, and `commitRevision`/`logRevisions`/`retrieveRevision` for git-style version control on revisioned resources.

## What's deferred

See [`PARITY.md`](./PARITY.md). Notable gaps in v0.2:

- Admin / EE endpoints (billing, subscription management, scopes, access-control). Use the raw `ag.client.post(...)` if you need them today.
- `/preview/invocations/*` (router exists on backend but isn't mounted yet).
- Custom workflows (no `@ag.route` analog yet — TypeScript users build their own server).

## Naming differences from the Python SDK

The TS SDK uses REST-style resource names; Python uses domain manager names. Map:

| Python | TypeScript |
|---|---|
| `ag.ConfigManager.get_from_registry(...)` | `ag.prompts.fetch({...})` |
| `ag.AppManager.create(...)` | `ag.applications.create({...})` |
| `ag.VariantManager.commit(...)` | `ag.revisions.commit({...})` |
| `ag.VariantManager.delete(...)` | `ag.applications.archiveVariant(...)` |
| `ag.DeploymentManager.deploy(...)` | `ag.environments.deploy({...})` |
| `ag.testsets.acreate(...)` | `ag.testsets.create({...})` |
| `ag.SecretsManager.*` | `ag.vault.*` |
| `ag.tracing.store_session(...)` | (TS — set via OTel baggage in `@agenta/sdk-tracing`) |

## Documentation

- Full docs: [agenta.ai/docs](https://agenta.ai/docs)
- TypeScript SDK setup: (coming with v0.2 docs)
- Python SDK reference (operation-equivalent): [Configuration management reference](https://agenta.ai/docs/reference/sdk/configuration-management)

## Examples

Three runnable scripts in [`examples/`](./examples/):

- [`fetch-prompt.ts`](./examples/fetch-prompt.ts) — fetch a prompt and use it with OpenAI
- [`manage-variants.ts`](./examples/manage-variants.ts) — create app, commit revisions, deploy, archive
- [`run-evaluation.ts`](./examples/run-evaluation.ts) — create testset, run evaluation, read results

Run with `tsx`:

```sh
AGENTA_API_KEY=sk-... AGENTA_PROJECT_ID=... pnpm tsx examples/fetch-prompt.ts
```

## License

MIT — see [LICENSE](../../../LICENSE).
