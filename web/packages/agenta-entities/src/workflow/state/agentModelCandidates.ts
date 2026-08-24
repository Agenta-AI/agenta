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
    if (showSubscriptions && !subscriptionSettled) {
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
            subscriptionSettled:
                !showSubscriptions || subscription?.data !== undefined || !!subscription?.isError,
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
            ? queryClient.fetchQuery<LlmProvider[]>(vaultQuery)
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
                  .catch(() => null)
            : Promise.resolve(null),
    ])

    return resolveAgentModelCandidateSources({
        vaultRows: vault.data,
        vaultError: vault.error,
        capabilities: capabilities.data,
        capabilitiesError: capabilities.error,
        subscriptionStatus: subscription,
        subscriptionSettled: true,
        pairModelSelection,
        showSubscriptions,
    })
}
