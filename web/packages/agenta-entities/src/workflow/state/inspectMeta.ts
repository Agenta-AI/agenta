/**
 * Harness capability atoms
 *
 * The per-harness connection capabilities (`providers` / `deployments` / `connection_modes` /
 * `model_selection` / `models`) come from the `harnesses` catalog
 * (`GET /workflows/catalog/harnesses/`), NOT from the workflow `/inspect` response. Inspect is
 * uniform across workflows — it carries no behavior-changing `meta`. A workflow's harness field
 * declares `x-ag-harness-ref`; the agent playground resolves the selected harness's capabilities
 * from this catalog to render a harness-filtered provider + model picker.
 *
 * Source: `sdks/python/agenta/sdk/agents/capabilities.py` (`harness_catalog_document`) served by
 * `api/oss/src/apis/fastapi/workflows/router.py` (`/catalog/harnesses/`).
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchHarnessCapabilities} from "../api"

import {persistedCatalogSeed, writePersistedCatalog} from "./persistedCatalog"

/** A real, sourced price (USD per million tokens). Never a rating. */
export interface ModelPricing {
    input_per_mtok: number
    output_per_mtok: number
    cache_read_per_mtok?: number | null
    cache_write_per_mtok?: number | null
    currency?: string
}

/** Curated, relative 1-5 scores. Higher is better; `cost` is cost-efficiency. Never a price. */
export interface ModelRatings {
    cost?: number | null
    intelligence?: number | null
    speed?: number | null
}

/**
 * One curated catalog record. Identity (`id`/`provider`) is the join key to the accepted set;
 * `name`/`pricing`/`context_window`/`modalities` are objective facts; `label`/`description`/
 * `ratings` are curated judgments. Everything past identity + `source` is optional.
 * Source: `sdks/python/agenta/sdk/agents/model_catalog.py`.
 */
export interface ModelCatalogEntry {
    id: string
    provider: string
    source?: string
    name?: string | null
    pricing?: ModelPricing | null
    context_window?: number | null
    modalities?: string[] | null
    label?: string | null
    description?: string | null
    ratings?: ModelRatings | null
}

/** One harness's connection-relevant capabilities, as served by the `harnesses` catalog. */
export interface HarnessCapabilities {
    /** Provider families the harness can reach (a literal list; never `"*"`). */
    providers: string[]
    /** Deployment surfaces it can consume (`["direct"]` for Pi today). */
    deployments?: string[]
    /** Supported connection modes (`["agenta", "self_managed"]`). */
    connection_modes: string[]
    /** How a model is named: `"provider/id"` (Pi) or `"alias"` (Claude). */
    model_selection: string
    /** Selectable models per provider family (provider -> list of ids/aliases). */
    models: Record<string, string[]>
    /**
     * The curated per-model catalog (label / description / pricing / ratings), keyed by the same
     * ids as `models`. Published additively next to `models`; the picker prefers it when present
     * and falls back to `models`. Absent on an older backend.
     */
    model_catalog?: ModelCatalogEntry[]
    /** External MCP servers the selected harness can consume. */
    mcp?: {
        user_servers?: {
            connection_types: string[]
            credentials: string[]
        } | null
    } | null
}

/** The full per-harness capability map (harness type -> capabilities). */
export type HarnessCapabilitiesMap = Record<string, HarnessCapabilities>

/**
 * The harness catalog. Global and project-independent (the catalog is static), so it is not keyed
 * by anything.
 *
 * Persisted to localStorage (`persistedCatalogSeed`) so an agent-playground reload has the harness
 * capabilities available for first paint (model picker + collapsed "Unavailable"/"Connect key"
 * badges) without a blocking fetch, then revalidates once in the background. NOT `staleTime:
 * Infinity` — harness capabilities are still evolving, so the disk seed is treated as stale-on-reload.
 */
const HARNESS_CATALOG_CACHE_KEY = "harness-catalog"
export const harnessCatalogQueryAtom = atomWithQuery<HarnessCapabilitiesMap>(() => {
    const seed = persistedCatalogSeed<HarnessCapabilitiesMap>(HARNESS_CATALOG_CACHE_KEY)
    // Disk seed present → the model picker / badges already painted, so this fetch is a background
    // revalidation; demote it to low priority so it yields to the critical-path queries.
    const lowPriority = seed.initialData !== undefined
    return {
        queryKey: ["workflows", "catalog", "harnesses"],
        queryFn: async () => {
            const catalog = (await fetchHarnessCapabilities({
                lowPriority,
            })) as unknown as HarnessCapabilitiesMap
            writePersistedCatalog(HARNESS_CATALOG_CACHE_KEY, catalog)
            return catalog
        },
        ...seed,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * The per-harness capability map from the `harnesses` catalog. `null` until the catalog resolves.
 * Keyed by the harness ref (a template's `x-ag-harness-ref` value) that selects this catalog; the
 * catalog data itself is global, so the key only documents which ref drove the lookup.
 */
export const harnessCapabilitiesAtomFamily = atomFamily((_harnessRef: string) =>
    atom<HarnessCapabilitiesMap | null>((get) => {
        const query = get(harnessCatalogQueryAtom)
        return query.data ?? null
    }),
)
