import {getHostQueryClient} from "@agenta/shared/api"
import type {LlmProvider} from "@agenta/shared/types"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {fetchVaultSecret} from "../../secret/api"
import {
    buildAgentModelCandidates,
    selectableAgentHarnesses,
    subscriptionPairsFrom,
    toProviderConnections,
    type AgentModelCandidate,
    type ProviderConnection,
} from "../../secret/core"
import {subscriptionPairModelsAtom, vaultSecretsQueryAtom} from "../../secret/state"
import {
    fetchHarnessCapabilities,
    fetchSubscriptionStatus,
    type SubscriptionStatusResponse,
} from "../api"

import {
    harnessCatalogIsUsable,
    harnessCatalogQueryAtom,
    type HarnessCapabilitiesMap,
} from "./inspectMeta"
import {
    SUBSCRIPTION_STATUS_QUERY_HARNESS,
    subscriptionStatusQueryAtomFamily,
} from "./subscriptionStatus"

export interface AgentModelCandidatesState {
    status: "loading" | "error" | "ready"
    candidates: AgentModelCandidate[]
    connections: ProviderConnection[]
    capabilities: HarnessCapabilitiesMap | null
    error: unknown | null
    /**
     * The subscription source could not be established: the check failed, or its answer could not
     * be read. The routes listed are still real, but they may not be all of them, so a caller must
     * not read an empty list as proof that nothing is runnable.
     */
    subscriptionUnknown: boolean
}

interface CandidateSourceState {
    vaultRows?: LlmProvider[]
    vaultError?: unknown
    capabilities?: HarnessCapabilitiesMap
    capabilitiesError?: unknown
    /** The runner's answer. `null` is the boundary schema's fallback for one we could not read. */
    subscriptionStatus?: SubscriptionStatusResponse | null
    subscriptionSettled: boolean
    /** The subscription check could not be MADE (rejected request), as opposed to answering "none". */
    subscriptionError?: unknown
    pairModelSelection?: Record<string, string[] | undefined> | null
    showSubscriptions: boolean
}

export const resolveAgentModelCandidateSources = ({
    vaultRows,
    vaultError,
    capabilities,
    capabilitiesError,
    subscriptionStatus,
    subscriptionSettled,
    subscriptionError,
    pairModelSelection,
    showSubscriptions,
}: CandidateSourceState): AgentModelCandidatesState => {
    const connections = toProviderConnections(vaultRows ?? [])
    // An EMPTY map is not a catalog: read as one it says no route is runnable, and the gate then
    // asks a keyed project for a key it already has (#6660). Unresolved, like a missing one.
    if (!vaultRows || !harnessCatalogIsUsable(capabilities)) {
        const error = vaultError ?? capabilitiesError ?? null
        return {
            status: error ? "error" : "loading",
            candidates: [],
            connections,
            capabilities: null,
            error,
            subscriptionUnknown: false,
        }
    }
    // A failed check never blocks on itself: fall through and answer from the vault alone.
    if (showSubscriptions && !subscriptionSettled && !subscriptionError) {
        return {
            status: "loading",
            candidates: [],
            connections,
            capabilities,
            error: null,
            subscriptionUnknown: false,
        }
    }

    const subscriptionPairs = showSubscriptions
        ? (subscriptionPairsFrom(subscriptionStatus?.harnesses ?? {}) ?? [])
        : []
    const candidates = buildAgentModelCandidates({
        connections,
        capabilities,
        harnessIds: selectableAgentHarnesses(Object.keys(capabilities)),
        showSubscriptions,
        subscriptionPairs,
        pairModelSelection,
    })

    // A check we could not MAKE, and an answer we could not READ, are both unknown. Neither is a
    // deployment with no subscription, so neither may stand as the reason the gate tells the user
    // to add a provider key. `null` is the boundary schema's fallback for an unreadable answer, and
    // the subscription card already calls that a failed check.
    //
    // The sources that DID resolve are still authoritative, so this stays `ready`: creation, the
    // model picker and the slash commands keep working off the routes we do know about. Only the
    // reading of an EMPTY list changes, which is why the flag travels with the state.
    // `incompatible` is the service's word for a runner it could not read, so it belongs here too.
    // `unavailable` does not: a runner that is not there really does offer no subscription route.
    const subscriptionUnknown =
        showSubscriptions &&
        (subscriptionStatus === null ||
            subscriptionStatus?.runner === "incompatible" ||
            (subscriptionStatus === undefined && !!subscriptionError))
    return {
        status: "ready",
        candidates,
        connections,
        capabilities,
        error: null,
        subscriptionUnknown,
    }
}

export const agentModelCandidatesAtomFamily = atomFamily((showSubscriptions: boolean) =>
    atom<AgentModelCandidatesState>((get) => {
        const vault = get(vaultSecretsQueryAtom)
        const harnessCatalog = get(harnessCatalogQueryAtom)
        const subscription = showSubscriptions
            ? get(subscriptionStatusQueryAtomFamily(SUBSCRIPTION_STATUS_QUERY_HARNESS))
            : null

        return resolveAgentModelCandidateSources({
            vaultRows: vault.data,
            vaultError: vault.data === undefined && vault.isError ? vault.error : undefined,
            // A cached empty map keeps `data` defined, so the error would be swallowed and the
            // state would sit in `loading` with no way back. Report it.
            capabilities: harnessCatalogIsUsable(harnessCatalog.data)
                ? harnessCatalog.data
                : undefined,
            capabilitiesError:
                !harnessCatalogIsUsable(harnessCatalog.data) && harnessCatalog.isError
                    ? harnessCatalog.error
                    : undefined,
            subscriptionStatus: subscription?.data,
            subscriptionSettled: !showSubscriptions || subscription?.data !== undefined,
            subscriptionError:
                subscription?.data === undefined && subscription?.isError
                    ? subscription.error
                    : undefined,
            pairModelSelection: showSubscriptions ? get(subscriptionPairModelsAtom) : null,
            showSubscriptions,
        })
    }),
)

const HARNESS_CATALOG_QUERY = {
    queryKey: ["workflows", "catalog", "harnesses"],
    queryFn: async () => (await fetchHarnessCapabilities()) as unknown as HarnessCapabilitiesMap,
    staleTime: 5 * 60_000,
    retry: false,
} as const

const subscriptionStatusQuery = (projectId: string) =>
    ({
        queryKey: [
            "workflows",
            "runtime",
            "subscription-status",
            SUBSCRIPTION_STATUS_QUERY_HARNESS,
            projectId,
        ],
        queryFn: () =>
            fetchSubscriptionStatus({harness: SUBSCRIPTION_STATUS_QUERY_HARNESS, projectId}),
        staleTime: 10_000,
        retry: false,
    }) as const

/**
 * The runner's subscription status for an imperative load, refetched once when the cache holds an
 * answer we could not read. `null` is that answer, and `ensureQueryData` would serve it forever, so
 * a retry after the runner recovered would make no request at all.
 */
const loadSubscriptionStatus = (
    queryClient: ReturnType<typeof getHostQueryClient>,
    projectId: string,
): Promise<{data: SubscriptionStatusResponse | null | undefined; error: unknown}> =>
    queryClient
        .ensureQueryData<SubscriptionStatusResponse | null>(subscriptionStatusQuery(projectId))
        .then((data) =>
            data === null
                ? queryClient.fetchQuery<SubscriptionStatusResponse | null>({
                      ...subscriptionStatusQuery(projectId),
                      staleTime: 0,
                  })
                : data,
        )
        .then((data) => ({data, error: undefined}))
        .catch((error: unknown) => ({data: undefined, error}))

/**
 * The catalog for an imperative load, refetched once when the cache holds an unusable map.
 * `ensureQueryData` hands back whatever is cached, so a `{}` from an older build would be served
 * forever, and a retry after the server recovered would make no request at all (#6660).
 */
const loadHarnessCatalog = (
    queryClient: ReturnType<typeof getHostQueryClient>,
): Promise<HarnessCapabilitiesMap> =>
    queryClient.ensureQueryData<HarnessCapabilitiesMap>(HARNESS_CATALOG_QUERY).then((data) =>
        harnessCatalogIsUsable(data)
            ? data
            : queryClient.fetchQuery<HarnessCapabilitiesMap>({
                  ...HARNESS_CATALOG_QUERY,
                  staleTime: 0,
              }),
    )

export async function loadAgentModelCandidates({
    projectId,
    userId,
    pairModelSelection,
    showSubscriptions = true,
    refreshVault = false,
}: {
    projectId: string
    userId: string
    pairModelSelection?: Record<string, string[] | undefined> | null
    showSubscriptions?: boolean
    refreshVault?: boolean
}): Promise<AgentModelCandidatesState> {
    const queryClient = getHostQueryClient()
    const vaultQuery = {
        queryKey: ["vault", "secrets", userId, projectId],
        queryFn: () => fetchVaultSecret({projectId}),
        staleTime: 5 * 60_000,
        retry: false,
    } as const
    const [vault, capabilities, subscription] = await Promise.all([
        (refreshVault
            ? queryClient.fetchQuery<LlmProvider[]>({...vaultQuery, staleTime: 0})
            : queryClient.ensureQueryData<LlmProvider[]>(vaultQuery)
        )
            .then((data) => ({data, error: undefined}))
            .catch((error: unknown) => ({data: undefined, error})),
        loadHarnessCatalog(queryClient)
            .then((data) => ({data, error: undefined}))
            .catch((error: unknown) => ({data: undefined, error})),
        showSubscriptions
            ? loadSubscriptionStatus(queryClient, projectId)
            : Promise.resolve({data: null, error: undefined}),
    ])

    return resolveAgentModelCandidateSources({
        vaultRows: vault.data,
        vaultError: vault.error,
        capabilities: capabilities.data,
        capabilitiesError: capabilities.error,
        subscriptionStatus: subscription.data,
        subscriptionSettled: subscription.data !== undefined,
        subscriptionError: subscription.error,
        pairModelSelection,
        showSubscriptions,
    })
}
