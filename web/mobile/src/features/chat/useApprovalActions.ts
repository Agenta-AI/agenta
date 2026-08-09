import {useCallback, useEffect, useRef, useState} from "react"

import {
    isInteractionConflict,
    queryInteractions,
    respondInteraction,
} from "@agenta/entities/session"

import {hasSettledResume, selectApprovalTargets, type ApprovalTarget} from "./approvalTargets"
import {buildApprovalAnswer} from "./steer"

export type ResumePhase = "idle" | "resuming" | "error"

/** Fern's `AgentaApiError` message is transport jargon — show the status instead. */
const respondErrorText = (error: unknown): string => {
    const status = (error as {statusCode?: number} | null)?.statusCode
    return status ? `Approval failed (HTTP ${status}).` : "Approval failed."
}

export interface ApprovalActions {
    phase: ResumePhase
    errorText: string | null
    /**
     * Answer one gate. Deny also resumes (the runner needs the denial round-trip). `message` is
     * the steer-lite redirect note that rides with a denial — see [[isSteerEnabled]] for where it
     * is actually delivered.
     */
    respond: (args: {approvalId: string; approved: boolean; message?: string}) => void
    /** Approve every pending gate — one respond call per gate (the endpoint is per-interaction). */
    approveAll: () => void
}

/**
 * Approve/deny pending HITL gates from the phone via the DETACHED respond dispatcher:
 * `POST /sessions/interactions/{id}/respond`. The backend CAS-flips the row to `responded`,
 * then the interactions worker rebuilds the turn's history from the durable records and
 * replays the gate's stamped effective config, so the parked run resumes WARM.
 *
 * Never hand-build an `/invoke` resume here: an invoke carrying stamped messages runs as a
 * NEW turn (`approval-mismatch (history)` → evict + cold) and leaves the interaction row
 * `pending`, so the gate never clears. Fire-and-forget: no stream is consumed, and the
 * records poll repaints the transcript until `pendingCount` drops to 0.
 */
export const useApprovalActions = ({
    sessionId,
    projectId,
    pendingApprovalIds,
}: {
    sessionId: string
    projectId: string
    /**
     * Approval ids currently pending in the transcript. The reset watches whether the ids WE
     * answered are still among them, not how many there are: answering the last gate of a turn
     * often raises the next one in the same poll, so a count-based reset sees 1 both before and
     * after and leaves every button disabled until the 60s timeout.
     */
    pendingApprovalIds: string[]
}): ApprovalActions => {
    const [phase, setPhase] = useState<ResumePhase>("idle")
    const [errorText, setErrorText] = useState<string | null>(null)
    const busyRef = useRef(false)
    // The ids of the gates the in-flight submit answered.
    const submittedRef = useRef<string[]>([])

    // The records poll caught the interaction_response (or the turn moved on) — settle.
    const pendingKey = pendingApprovalIds.join(" ")
    useEffect(() => {
        const pending = pendingKey ? pendingKey.split(" ") : []
        if (!hasSettledResume(submittedRef.current, pending)) return
        setPhase((current) => (current === "resuming" ? "idle" : current))
    }, [pendingKey])

    // Failure-path re-arm: if the respond was accepted but the run dies before the gate
    // resolves, the poll never settles us — drop back to idle so the buttons re-arm.
    useEffect(() => {
        if (phase !== "resuming") return
        const handle = setTimeout(() => setPhase("idle"), 60_000)
        return () => clearTimeout(handle)
    }, [phase])

    const submit = useCallback(
        async (target: ApprovalTarget, approved: boolean, message?: string) => {
            if (busyRef.current) return
            busyRef.current = true
            submittedRef.current = []
            setPhase("resuming")
            setErrorText(null)
            try {
                // Never answer a stale gate — re-read the actionable rows (pending + in TTL).
                const rows = await queryInteractions({
                    sessionId,
                    projectId,
                    actionableOnly: true,
                })
                const targets = selectApprovalTargets(rows, target)
                if (targets.length === 0) {
                    throw new Error(
                        target.all
                            ? "No pending approval found — the turn may have moved on."
                            : "This approval is no longer pending — refresh and retry.",
                    )
                }
                // The transcript keys a gate by the row's `token`; that is what the reset above
                // watches for.
                submittedRef.current = targets
                    .map((row) => row.token)
                    .filter((token): token is string => typeof token === "string")
                let answered = 0
                for (const row of targets) {
                    try {
                        await respondInteraction({
                            interactionId: row.id as string,
                            projectId,
                            answer: buildApprovalAnswer(approved, message),
                        })
                        answered += 1
                    } catch (err) {
                        // Someone (desktop, another tab) already answered this gate — benign.
                        if (!isInteractionConflict(err)) throw new Error(respondErrorText(err))
                    }
                }
                // Every target was already answered: nothing is resuming, so re-arm now
                // instead of waiting out the 60s timeout.
                if (answered === 0) {
                    submittedRef.current = []
                    setPhase("idle")
                }
            } catch (err) {
                submittedRef.current = []
                setPhase("error")
                setErrorText(err instanceof Error ? err.message : "Resume failed.")
            } finally {
                busyRef.current = false
            }
        },
        [sessionId, projectId],
    )

    const respond = useCallback(
        ({
            approvalId,
            approved,
            message,
        }: {
            approvalId: string
            approved: boolean
            message?: string
        }) => {
            void submit({approvalId}, approved, message)
        },
        [submit],
    )
    const approveAll = useCallback(() => {
        void submit({all: true}, true)
    }, [submit])

    return {phase, errorText, respond, approveAll}
}
