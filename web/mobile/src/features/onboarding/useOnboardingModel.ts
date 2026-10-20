import {useCallback, useEffect, useMemo, useRef} from "react"

import {
    agentModelSelectionIsRunnable,
    firstAgentModelForConnection,
    providerConnectionsAtom,
    resolveAgentModelSelection,
    subscriptionConnectionFor,
    useVaultSecret,
    type AgentModelCandidate,
    type AgentModelSelection,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    readHarnessKind,
    readModelConnection,
    readModelId,
    withHarnessKind,
    withModel,
} from "@agenta/entity-ui/drill-in"
import {useAtomValue, useSetAtom} from "jotai"

import {useWalletSummary} from "../wallet/useWalletSummary"

import {draftConfigurationAtom} from "./onboardingConfig"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {
    useOnboardingSubscription,
    type OnboardingSubscription,
    type PendingSwitch,
} from "./useOnboardingSubscription"

/** The Vault slug of the budget-capped connection a new organization is seeded with. */
const STARTER_CREDITS_SLUG = "starter-credits"

export interface OnboardingModel {
    status: "loading" | "error" | "ready"
    /** A runnable model is selected, so Create can run the agent. */
    ready: boolean
    /** Agenta-funded runs: the starter-credits connection, built-in models, or the wallet. */
    credits: {
        inUse: boolean
        /** Some model runs on these credits. */
        runnable: boolean
        /** Spendable wallet balance in micro-dollars; `null` where the wallet reports none. */
        balanceMusd: number | null
    } | null
    chatgpt: OnboardingSubscription
    claude: OnboardingSubscription
    keys: {
        connections: ProviderConnection[]
        inUse: boolean
        /** A key was saved: switch to its first model once the vault refetch lists it. */
        onSaved: (connectionId?: string) => void
    }
    retry: () => void
}

/** The model the config names, in the shape the candidate list is matched against. */
const configuredSelection = (configuration: unknown): AgentModelSelection | null => {
    const modelId = readModelId(configuration)
    const harness = readHarnessKind(configuration)
    const connection = readModelConnection(configuration)
    return modelId && harness && connection ? {modelId, harness, ...connection} : null
}

/** The first agent's model, no picker: credits first, then a connection made here, then any. */
export const useOnboardingModel = (entityId: string | null, projectId: string): OnboardingModel => {
    const candidates = useAtomValue(agentModelCandidatesAtomFamily(true))
    const configuration = useAtomValue(useMemo(() => draftConfigurationAtom(entityId), [entityId]))
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const allConnections = useAtomValue(providerConnectionsAtom)
    const {mutate: refreshVault} = useVaultSecret()
    const wallet = useWalletSummary(projectId, {poll: false}).data

    const selection = useMemo(() => configuredSelection(configuration), [configuration])
    const runnable = agentModelSelectionIsRunnable(candidates.candidates, selection)
    const selected = runnable
        ? (resolveAgentModelSelection({candidates: candidates.candidates, explicit: selection}) ??
          undefined)
        : undefined
    const creditsConnection =
        allConnections.find((item) => item.slug === STARTER_CREDITS_SLUG) ?? null
    const creditsId = creditsConnection?.id
    const isCredits = useCallback(
        (item: AgentModelCandidate | undefined) =>
            item?.namespace === "builtin" ||
            (Boolean(creditsId) && item?.connectionKey === creditsId),
        [creditsId],
    )

    // Latest config: a switch can land renders after the event that armed it.
    const configurationRef = useRef(configuration)
    configurationRef.current = configuration
    const select = useCallback(
        (candidate: AgentModelCandidate) => {
            const next = withModel(
                withHarnessKind(configurationRef.current, candidate.harness),
                candidate,
            )
            if (next && entityId) updateConfiguration(entityId, next)
        },
        [entityId, updateConfiguration],
    )

    // `configuration` re-runs the pick when the config lands after the candidates did.
    useEffect(() => {
        if (candidates.status !== "ready" || selected || !configuration) return
        const preferred =
            candidates.candidates.find(isCredits) ??
            resolveAgentModelSelection({candidates: candidates.candidates})
        if (preferred) select(preferred)
    }, [candidates.status, candidates.candidates, configuration, selected, select, isCredits])

    const candidatesRef = useRef(candidates.candidates)
    candidatesRef.current = candidates.candidates
    const pendingRef = useRef<PendingSwitch | null>(null)
    const arm = useCallback(
        (pending: PendingSwitch) => {
            const pick = pending(candidatesRef.current)
            pendingRef.current = pick ? null : pending
            if (pick) select(pick)
        },
        [select],
    )
    useEffect(() => {
        const pick = pendingRef.current?.(candidates.candidates)
        if (!pick) return
        pendingRef.current = null
        select(pick)
    }, [candidates.candidates, select])

    const chatgptConnection = subscriptionConnectionFor(candidates.connections, "chatgpt")
    const chatgpt = useOnboardingSubscription({
        connection: chatgptConnection,
        available: Boolean(chatgptConnection || candidates.capabilities?.codex),
        status: candidates.status,
        selected,
        arm,
        connectedMessage: ONBOARDING_COPY.model.chatgptConnected,
    })
    const claudeConnection = subscriptionConnectionFor(candidates.connections, "claude")
    const claude = useOnboardingSubscription({
        connection: claudeConnection,
        available: Boolean(claudeConnection || candidates.capabilities?.claude),
        status: candidates.status,
        selected,
        arm,
        connectedMessage: ONBOARDING_COPY.model.claudeConnected,
    })

    // A save lands before the vault refetch does, so it arms a switch the new list fires.
    const onSaved = useCallback(
        (connectionId?: string) => {
            if (connectionId)
                arm((list) => firstAgentModelForConnection(list, connectionId) ?? undefined)
            void refreshVault()
        },
        [arm, refreshVault],
    )

    const keyConnections = candidates.connections.filter((item) => !item.subscription)
    const walletBalance =
        wallet?.mode === "enforce" && wallet.spendable_musd !== null
            ? Math.max(0, wallet.spendable_musd)
            : null
    const creditsRunnable = candidates.candidates.some(isCredits)
    const hasCredits = Boolean(creditsConnection) || creditsRunnable || wallet?.mode === "enforce"

    return {
        // Until the draft agent exists there is nothing to run on yet.
        status: entityId ? candidates.status : "loading",
        ready: Boolean(entityId) && candidates.status === "ready" && Boolean(selected),
        credits: hasCredits
            ? {inUse: isCredits(selected), runnable: creditsRunnable, balanceMusd: walletBalance}
            : null,
        chatgpt,
        claude,
        keys: {
            connections: keyConnections,
            inUse: keyConnections.some(
                (item) => item.id === selected?.connectionKey && item.id !== creditsConnection?.id,
            ),
            onSaved,
        },
        retry: () => void refreshVault(),
    }
}
