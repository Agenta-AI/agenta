import {useEffect, useRef, useState} from "react"

import {
    firstAgentModelForConnection,
    subscriptionIsReady,
    type AgentModelCandidate,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {message} from "@agenta/ui/app-message"

/** Picks the candidate a pending switch is waiting for, once the candidate list has it. */
export type PendingSwitch = (
    candidates: readonly AgentModelCandidate[],
) => AgentModelCandidate | undefined

export interface OnboardingSubscription {
    available: boolean
    connection: ProviderConnection | null
    ready: boolean
    inUse: boolean
    dialogOpen: boolean
    setDialogOpen: (open: boolean) => void
}

/** One subscription row: when its connection turns ready, the agent switches to its first model. */
export const useOnboardingSubscription = ({
    connection,
    available,
    status,
    selected,
    arm,
    connectedMessage,
}: {
    connection: ProviderConnection | null
    available: boolean
    status: "loading" | "error" | "ready"
    selected: AgentModelCandidate | undefined
    arm: (pending: PendingSwitch) => void
    connectedMessage: string
}): OnboardingSubscription => {
    const ready = subscriptionIsReady(connection?.subscription)
    const connectionId = connection?.id
    const [dialogOpen, setDialogOpen] = useState(false)
    const dialogOpenRef = useRef(dialogOpen)
    dialogOpenRef.current = dialogOpen

    // Baseline taken once the candidates answer, so a connection that already existed never switches.
    const wasReady = useRef<boolean | null>(null)
    useEffect(() => {
        if (status !== "ready") return
        const was = wasReady.current
        wasReady.current = ready
        if (was === null || !ready || was || !connectionId) return
        arm((list) => firstAgentModelForConnection(list, connectionId) ?? undefined)
        if (dialogOpenRef.current) {
            setDialogOpen(false)
            message.success(connectedMessage)
        }
    }, [status, ready, connectionId, arm, connectedMessage])

    return {
        available,
        connection,
        ready,
        inUse: Boolean(connectionId) && selected?.connectionKey === connectionId,
        dialogOpen,
        setDialogOpen,
    }
}
