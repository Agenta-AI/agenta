import React from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, type QueryKey} from "@tanstack/react-query"
import {getDefaultStore, type WritableAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/**
 * Data seam for data-connected stories.
 *
 * Nothing here touches product code. Both injection points already exist because the app
 * itself uses them:
 *
 *  1. **Gate atoms.** `projectIdAtom` / `sessionAtom` are primitive atoms the app populates
 *     (`@agenta/shared/src/state/session.ts`: "a primitive atom that should be populated by
 *     the app. Entity packages read from this to gate queries behind auth readiness").
 *     Nearly every query is gated on them — `enabled: get(sessionAtom) && Boolean(projectId)`.
 *  2. **The QueryClient.** The app injects it with `useHydrateAtoms([[queryClientAtom, qc]])`
 *     (`oss/src/state/Providers.tsx:21`). Seeding that client's cache seeds every
 *     `atomWithQuery` AND every molecule, because `createEntityController` derives
 *     `serverData` from `query.data` ("single source of truth for server state").
 *
 * ## Isolation
 *
 * Stories share one Jotai store — they must, because ~120 files call `getDefaultStore()`
 * imperatively, and jotai's `defaultStore` is a memoized module variable with no reset
 * (`INTERNAL_overrideCreateStore` only affects stores built after it runs). So isolation is
 * achieved by NOT COLLIDING rather than by resetting:
 *
 *  - **L1 — scoped ids.** Nearly all leaky state is `atomFamily(id)`-keyed (drafts, dirty
 *    flags, server data). Each story gets its own id namespace via `scope.id()`, so two
 *    stories cannot address the same family entry. This covers the bulk of the surface.
 *  - **L2 — explicit reset.** The residue is non-family singletons (81 in entities+shared,
 *    but a story touches a handful) plus localStorage-backed atoms, which survive even a
 *    page reload. Gates reset on every story; `reset` declares any others; localStorage is
 *    rewound to the keys present at first load.
 *  - **L3 — `isolate: "reload"`.** Escape hatch: reloads the iframe so the module graph is
 *    virgin, making interactive browsing behave exactly like the VRT (which navigates per
 *    story). Opt-in, so the pure parity stories never pay for it.
 */

/** Per-story id namespace. Domain fixtures build their entity ids through this. */
export interface StoryScope {
    /** Short stable token derived from the story id. */
    key: string
    /** Namespaces an entity id to this story: `scope.id("rev")` → `"rev-4k2p1x"`. */
    id: (name: string) => string
    /** Story-scoped project id — it is part of most query keys, so it isolates too. */
    projectId: string
}

export type QueryFixtures = [QueryKey, unknown][]

export interface AgentaDataParameters {
    /** Query cache entries. As a function, receives this story's id scope (preferred). */
    queries?: QueryFixtures | ((scope: StoryScope) => QueryFixtures)
    /** Args derived from the scope, merged over the story's static args. */
    args?: (scope: StoryScope) => Record<string, unknown>
    /** Seeds `sessionAtom` (the auth gate). Defaults to true. */
    session?: boolean
    /** Extra primitive atoms to seed. */

    atoms?: [WritableAtom<any, any[], any>, unknown][]
    /** L2: non-family singleton atoms to rewind to a known value before this story renders. */

    reset?: [WritableAtom<any, any[], any>, unknown][]
    /** L3: force a virgin module graph. Use only when scoping + reset are not enough. */
    isolate?: "reload"
}

/** 32-bit string hash → base36. Short, stable, collision-safe enough for story ids. */
function hash(input: string): string {
    let h = 2166136261
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(36)
}

export function storyScope(storyId: string): StoryScope {
    const key = hash(storyId)
    return {
        key,
        id: (name: string) => `${name}-${key}`,
        projectId: `project-${key}`,
    }
}

/**
 * A QueryClient that serves fixtures and never reaches the network.
 *
 * `staleTime: Infinity` + `refetchOnMount: false` is what keeps a seeded key from ever
 * running its real `queryFn` — a per-query `staleTime` (several atoms set 30_000) overrides
 * the default, so `refetchOnMount` is the load-bearing half of the pair.
 */
export function storyQueryClient(): QueryClient {
    const client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: Infinity,
                gcTime: Infinity,
                refetchOnMount: false,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchInterval: false,
            },
        },
    })

    // Fixture-authoring aid: anything that actually tries to fetch had no fixture, so print
    // the key it wanted. Writing a fixture becomes "run the story, read the console".
    client.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.query.state.fetchStatus !== "fetching") return
        console.warn(
            "[withAgentaData] no fixture for queryKey — add it to parameters.agenta.queries:\n" +
                JSON.stringify(event.query.queryKey),
        )
    })

    return client
}

/** Fallback client for stories that declare no fixtures (the parity stories). */
let fallbackClient: QueryClient | undefined
export function defaultStoryQueryClient(): QueryClient {
    return (fallbackClient ??= storyQueryClient())
}

// ---------------------------------------------------------------------------
// L2 — localStorage rewind
// ---------------------------------------------------------------------------

// Keys present when the iframe loaded. Anything a story adds beyond this is rewound, which
// is prefix-agnostic — a key written through a computed name can't slip past an allowlist.
let baselineStorageKeys: Set<string> | undefined

/** Owned by other decorators/tools, not by story state. */
const STORAGE_KEEP = (key: string) =>
    key === "agenta-theme" || key.startsWith("@storybook") || key.startsWith("storybook")

function rewindLocalStorage() {
    if (typeof window === "undefined") return
    try {
        if (!baselineStorageKeys) {
            baselineStorageKeys = new Set(Object.keys(window.localStorage))
            return
        }
        for (const key of Object.keys(window.localStorage)) {
            if (baselineStorageKeys.has(key) || STORAGE_KEEP(key)) continue
            window.localStorage.removeItem(key)
        }
    } catch {
        /* private mode / blocked storage — nothing to rewind */
    }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export function seedAgentaData(
    params: AgentaDataParameters,
    scope: StoryScope,
    queryClient: QueryClient,
) {
    const store = getDefaultStore()

    rewindLocalStorage()

    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, scope.projectId)
    store.set(sessionAtom, params.session ?? true)

    for (const [atomToReset, value] of params.reset ?? []) {
        store.set(atomToReset, value)
    }
    for (const [atomToSeed, value] of params.atoms ?? []) {
        store.set(atomToSeed, value)
    }

    const queries = typeof params.queries === "function" ? params.queries(scope) : params.queries
    for (const [queryKey, data] of queries ?? []) {
        queryClient.setQueryData(queryKey, data)
    }
}

// ---------------------------------------------------------------------------
// L3 — reload isolation
// ---------------------------------------------------------------------------

// The story rendered since this module was evaluated. Empty on a fresh page load, so an
// `isolate: "reload"` story entered directly (the VRT's path) never reloads — only a
// same-page switch from another story does. That also makes the loop impossible.
let renderedStoryId: string | undefined

function needsReload(storyId: string, params: AgentaDataParameters | undefined): boolean {
    if (params?.isolate !== "reload") return false
    return renderedStoryId !== undefined && renderedStoryId !== storyId
}

/**
 * Storybook decorator hook. A story opts in with `parameters.agenta`; stories without it are
 * untouched and share one empty client.
 */
export function useAgentaData(params: AgentaDataParameters | undefined, storyId: string) {
    const scope = React.useMemo(() => storyScope(storyId), [storyId])
    // One client per story so fixtures never leak between stories.
    const queryClient = React.useMemo(() => storyQueryClient(), [storyId])

    const reload = needsReload(storyId, params)
    React.useEffect(() => {
        if (reload) window.location.reload()
    }, [reload])

    if (!reload) {
        renderedStoryId = storyId
        if (params) seedAgentaData(params, scope, queryClient)
    }

    return {
        queryClient,
        reload,
        args: params?.args?.(scope),
    }
}
