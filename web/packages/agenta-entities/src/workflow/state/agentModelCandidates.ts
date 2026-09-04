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

import {harnessCatalogQueryAtom, type HarnessCapabilitiesMap} from "./inspectMeta"
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
}

interface CandidateSourceState {
    vaultRows?: LlmProvider[]
    vaultError?: unknown
    capabilities?: HarnessCapabilitiesMap
    capabilitiesError?: unknown
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
    if (!vaultRows || !capabilities) {
        const error = vaultError ?? capabilitiesError ?? null
        return {
            status: error ? "error" : "loading",
            candidates: [],
            connections,
            capabilities: null,
            error,
        }
    }
    // A failed check never blocks on itself: fall through and answer from the vault alone.
    if (showSubscriptions && !subscriptionSettled && !subscriptionError) {
        return {status: "loading", candidates: [], connections, capabilities, error: null}
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

    // A check we could not MAKE is not a deployment with no subscription. Reading a rejected
    // request as "no pairs" turns an unreachable runner into "you have no runnable model", and the
    // gate that follows tells the user to add a provider key the agent may not even use.
    //
    // It only matters when nothing else is runnable: with vault candidates in hand the gate's
    // question is already answered yes, and the pairs we could not read would have added more, not
    // fewer. So report the failure only in the case where it changes the answer, and let the gate
    // stand down there rather than blocking the composer on a claim we never established.
    if (
        showSubscriptions &&
        subscriptionStatus === undefined &&
        subscriptionError &&
        candidates.length === 0
    ) {
        return {
            status: "error",
            candidates: [],
            connections,
            capabilities,
            error: subscriptionError,
        }
    }
    return {status: "ready", candidates, connections, capabilities, error: null}
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
            capabilities: harnessCatalog.data,
            capabilitiesError:
                harnessCatalog.data === undefined && harnessCatalog.isError
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
        queryClient
            .ensureQueryData<HarnessCapabilitiesMap>({
                queryKey: ["workflows", "catalog", "harnesses"],
                queryFn: async () =>
                    (await fetchHarnessCapabilities()) as unknown as HarnessCapabilitiesMap,
                staleTime: 5 * 60_000,
                retry: false,
            })
            .then((data) => ({data, error: undefined}))
            .catch((error: unknown) => ({data: undefined, error})),
        showSubscriptions
            ? queryClient
                  .ensureQueryData<SubscriptionStatusResponse | null>({
                      queryKey: [
                          "workflows",
                          "runtime",
                          "subscription-status",
                          SUBSCRIPTION_STATUS_QUERY_HARNESS,
                          projectId,
                      ],
                      queryFn: () =>
                          fetchSubscriptionStatus({
                              harness: SUBSCRIPTION_STATUS_QUERY_HARNESS,
                              projectId,
                          }),
                      staleTime: 10_000,
                      retry: false,
                  })
                  .then((data) => ({data, error: undefined}))
                  .catch((error: unknown) => ({data: undefined, error}))
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
