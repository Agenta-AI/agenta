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
}

/** The full per-harness capability map (harness type -> capabilities). */
export type HarnessCapabilitiesMap = Record<string, HarnessCapabilities>

/**
 * The harness catalog, fetched once and cached. Global and project-independent (the catalog is
 * static), so it is not keyed by anything.
 */
export const harnessCatalogQueryAtom = atomWithQuery<HarnessCapabilitiesMap>(() => ({
    queryKey: ["workflows", "catalog", "harnesses"],
    queryFn: async () => (await fetchHarnessCapabilities()) as unknown as HarnessCapabilitiesMap,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
}))

/**
 * The per-harness capability map from the `harnesses` catalog. `null` until the catalog resolves.
 * Keyed for signature compatibility with consumers; the data itself is not revision-scoped.
 */
export const harnessCapabilitiesAtomFamily = atomFamily((_revisionId: string) =>
    atom<HarnessCapabilitiesMap | null>((get) => {
        const query = get(harnessCatalogQueryAtom)
        return query.data ?? null
    }),
)
