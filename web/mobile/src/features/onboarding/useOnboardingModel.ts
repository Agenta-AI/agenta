import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    providerConnectionsAtom,
    useVaultSecret,
    type AgentModelCandidate,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    readHarnessKind,
    readModelConnectionSlug,
    readModelId,
    withHarnessKind,
    withModel,
} from "@agenta/entity-ui/drill-in"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import {ONBOARDING_COPY} from "./onboardingCopy"

/** Picks the candidate a pending switch is waiting for, once the candidate list has it. */
type PendingSwitch = (candidates: readonly AgentModelCandidate[]) => AgentModelCandidate | undefined

export interface OnboardingModel {
    status: "loading" | "error" | "ready"
    /** A runnable model is selected, so the flow may continue. */
    ready: boolean
    nextLabel: string
    managed: boolean
    noneAvailable: boolean
    chatgpt: {
        available: boolean
        connection: ProviderConnection | null
        ready: boolean
        dialogOpen: boolean
        setDialogOpen: (open: boolean) => void
    }
    keys: {
        connections: ProviderConnection[]
        drawerOpen: boolean
        openDrawer: () => void
        closeDrawer: () => void
        onSaved: () => void
        /** Every vault connection, for the drawer's connected list. */
        all: ProviderConnection[]
    }
    retry: () => void
}

/**
 * The model the first agent runs on. There is no picker: credits win by default, a ChatGPT
 * sign-in or a key saved here takes over, and the first available candidate is the fallback.
 */
export const useOnboardingModel = (entityId: string): OnboardingModel => {
    const candidates = useAtomValue(agentModelCandidatesAtomFamily(true))
    const configuration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const allConnections = useAtomValue(providerConnectionsAtom)
    const {mutate: refreshVault} = useVaultSecret()

    const currentModel = readModelId(configuration)
    const currentHarness = readHarnessKind(configuration)
    const currentSlug = readModelConnectionSlug(configuration)
    const selected = candidates.candidates.find(
        (item) =>
            item.modelId === currentModel &&
            item.harness === currentHarness &&
            item.slug === currentSlug,
    )
    const managed = candidates.candidates.find((item) => item.managed)
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
            managed ??
            candidates.candidates.find((item) => item.harness === "codex") ??
            candidates.candidates[0]
        if (preferred) select(preferred)
    }, [candidates.status, candidates.candidates, configuration, selected, managed, select])

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
    const wasChatgptReady = useRef(chatgptReady)
    useEffect(() => {
        if (chatgptReady && !wasChatgptReady.current) {
            arm((list) => list.find((item) => item.harness === "codex"))
            if (dialogOpenRef.current) {
                setChatgptDialogOpen(false)
                message.success(ONBOARDING_COPY.model.chatgptConnected)
            }
        }
        wasChatgptReady.current = chatgptReady
    }, [chatgptReady, arm])

    const [drawerOpen, setDrawerOpen] = useState(false)
    const knownKeysRef = useRef<Set<string>>(new Set())
    const openDrawer = useCallback(() => {
        knownKeysRef.current = new Set(candidates.candidates.map((item) => item.connectionKey))
        setDrawerOpen(true)
    }, [candidates.candidates])
    // A save lands before the vault refetch does, so it arms a switch the new list fires.
    const onSaved = useCallback(() => {
        arm((list) =>
            list.find(
                (item) =>
                    item.source === "connection" &&
                    !item.managed &&
                    !knownKeysRef.current.has(item.connectionKey),
            ),
        )
        void refreshVault()
    }, [arm, refreshVault])

    const nextLabel = selected?.managed
        ? ONBOARDING_COPY.model.nextWithCredits
        : selected?.harness === "codex"
          ? ONBOARDING_COPY.model.nextWithChatgpt
          : ONBOARDING_COPY.model.nextWithKey

    return {
        status: candidates.status,
        ready: candidates.status === "ready" && Boolean(selected),
        nextLabel,
        managed: Boolean(managed),
        noneAvailable: candidates.status === "ready" && candidates.candidates.length === 0,
        chatgpt: {
            available: Boolean(chatgptConnection || candidates.capabilities?.codex),
            connection: chatgptConnection,
            ready: chatgptReady,
            dialogOpen: chatgptDialogOpen,
            setDialogOpen: setChatgptDialogOpen,
        },
        keys: {
            connections: candidates.connections.filter((item) => !item.subscription),
            drawerOpen,
            openDrawer,
            closeDrawer: () => setDrawerOpen(false),
            onSaved,
            all: allConnections,
        },
        retry: () => void refreshVault(),
    }
}
