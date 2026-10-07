import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    agentModelSelectionIsRunnable,
    firstAgentModelForConnection,
    providerConnectionsAtom,
    resolveAgentModelSelection,
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
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import {useWalletSummary} from "../wallet/useWalletSummary"

import {ONBOARDING_COPY} from "./onboardingCopy"

/** Picks the candidate a pending switch is waiting for, once the candidate list has it. */
type PendingSwitch = (candidates: readonly AgentModelCandidate[]) => AgentModelCandidate | undefined

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
    chatgpt: {
        available: boolean
        connection: ProviderConnection | null
        ready: boolean
        inUse: boolean
        dialogOpen: boolean
        setDialogOpen: (open: boolean) => void
    }
    keys: {
        connections: ProviderConnection[]
        inUse: boolean
        drawerOpen: boolean
        openDrawer: () => void
        closeDrawer: () => void
        /** A key was saved: switch to its first model once the vault refetch lists it. */
        onSaved: (connectionId?: string) => void
        /** Every vault connection, for the drawer's connected list. */
        all: ProviderConnection[]
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
export const useOnboardingModel = (entityId: string, projectId: string): OnboardingModel => {
    const candidates = useAtomValue(agentModelCandidatesAtomFamily(true))
    const configuration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const allConnections = useAtomValue(providerConnectionsAtom)
    const {mutate: refreshVault} = useVaultSecret()
    const wallet = useWalletSummary(projectId).data

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
    const chatgptConnection = candidates.connections.find((item) => item.subscription) ?? null
    const chatgptReady = chatgptConnection?.subscription?.loginState === "ready"

    // Latest config: a switch can land renders after the event that armed it.
    const configurationRef = useRef(configuration)
    configurationRef.current = configuration
    const select = useCallback(
        (candidate: AgentModelCandidate) => {
            const next = withModel(
                withHarnessKind(configurationRef.current, candidate.harness),
                candidate,
            )
            if (next) updateConfiguration(entityId, next)
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

    const [chatgptDialogOpen, setChatgptDialogOpen] = useState(false)
    const dialogOpenRef = useRef(chatgptDialogOpen)
    dialogOpenRef.current = chatgptDialogOpen
    // Baseline taken once the candidates answer, so a sign-in that already existed never switches.
    const wasChatgptReady = useRef<boolean | null>(null)
    useEffect(() => {
        if (candidates.status !== "ready") return
        const was = wasChatgptReady.current
        wasChatgptReady.current = chatgptReady
        if (was === null || !chatgptReady || was) return
        arm((list) => list.find((item) => item.harness === "codex"))
        if (dialogOpenRef.current) {
            setChatgptDialogOpen(false)
            message.success(ONBOARDING_COPY.model.chatgptConnected)
        }
    }, [candidates.status, chatgptReady, arm])

    const [drawerOpen, setDrawerOpen] = useState(false)
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
        status: candidates.status,
        ready: candidates.status === "ready" && Boolean(selected),
        credits: hasCredits
            ? {inUse: isCredits(selected), runnable: creditsRunnable, balanceMusd: walletBalance}
            : null,
        chatgpt: {
            available: Boolean(chatgptConnection || candidates.capabilities?.codex),
            connection: chatgptConnection,
            ready: chatgptReady,
            inUse:
                selected?.source === "subscription" ||
                (Boolean(chatgptConnection) && selected?.connectionKey === chatgptConnection?.id),
            dialogOpen: chatgptDialogOpen,
            setDialogOpen: setChatgptDialogOpen,
        },
        keys: {
            connections: keyConnections,
            inUse: keyConnections.some(
                (item) => item.id === selected?.connectionKey && item.id !== creditsConnection?.id,
            ),
            drawerOpen,
            openDrawer: () => setDrawerOpen(true),
            closeDrawer: () => setDrawerOpen(false),
            onSaved,
            all: allConnections,
        },
        retry: () => void refreshVault(),
    }
}
