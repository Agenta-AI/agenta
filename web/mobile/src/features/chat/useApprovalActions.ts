import {useCallback, useEffect, useRef, useState} from "react"

import {loadSessionMessages} from "@agenta/chat/assets"
import {getPendingApprovals} from "@agenta/chat/model"
import {
    buildAgentResumeRequest,
    resolveInvocationUrl,
    type AgentResumeReference,
} from "@agenta/chat/transport"
import {queryInteractions} from "@agenta/entities/session"

import {stampApprovalResponses} from "./approvalStamp"

export type ResumePhase = "idle" | "resuming" | "error"

export interface ApprovalActions {
    phase: ResumePhase
    errorText: string | null
    /** Answer one gate. Deny also resumes (the runner needs the denial round-trip). */
    respond: (args: {approvalId: string; approved: boolean}) => void
    /** Approve every pending gate — all responses ride ONE resume POST. */
    approveAll: () => void
}

/** Keep only `{id, slug, version}` string fields of the interaction row's role-keyed refs. */
const sanitizeReferences = (
    raw: Record<string, unknown> | null | undefined,
): Record<string, AgentResumeReference> | null => {
    if (!raw) return null
    const out: Record<string, AgentResumeReference> = {}
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") continue
        const {id, slug, version} = value as Record<string, unknown>
        const ref: AgentResumeReference = {}
        if (typeof id === "string") ref.id = id
        if (typeof slug === "string") ref.slug = slug
        if (typeof version === "string") ref.version = version
        if (Object.keys(ref).length > 0) out[key] = ref
    }
    return Object.keys(out).length > 0 ? out : null
}

/**
 * Approve/deny pending HITL gates from the phone — the lite resume path (plan M1.3):
 * fresh records → stamp `approval-responded` on the tail → ONE references-only invoke POST
 * (`buildAgentResumeRequest`), fire-and-forget. No live SSE consumption: the response is
 * drained in the background and the tightened records poll repaints the transcript until the
 * turn settles (`phase` drops back to idle once no gate is pending).
 */
export const useApprovalActions = ({
    sessionId,
    projectId,
    pendingCount,
}: {
    sessionId: string
    projectId: string
    /** Pending gates currently visible in the transcript — drives the resuming→idle reset. */
    pendingCount: number
}): ApprovalActions => {
    const [phase, setPhase] = useState<ResumePhase>("idle")
    const [errorText, setErrorText] = useState<string | null>(null)
    const busyRef = useRef(false)

    // The records poll caught the interaction_response (or the turn moved on) — settle.
    useEffect(() => {
        if (pendingCount === 0) {
            setPhase((current) => (current === "resuming" ? "idle" : current))
        }
    }, [pendingCount])

    const submit = useCallback(
        async (target: {all: true} | {all?: false; approvalId: string}, approved: boolean) => {
            if (busyRef.current) return
            busyRef.current = true
            setPhase("resuming")
            setErrorText(null)
            try {
                // Never stamp a stale tail — re-read the durable records first.
                const messages = (await loadSessionMessages(sessionId)) ?? []
                const pending = getPendingApprovals(messages)
                if (pending.length === 0) {
                    throw new Error("No pending approval found — the turn may have moved on.")
                }
                const ids = target.all ? pending.map((p) => p.approvalId) : [target.approvalId]
                const stamped = stampApprovalResponses(messages, ids, approved)
                if (stamped === messages) {
                    throw new Error("This approval is no longer pending — refresh and retry.")
                }
                // The interaction row stores the run's role-keyed workflow references —
                // the resolver hydrates config from them server-side (references-only body).
                const interactions = await queryInteractions({
                    sessionId,
                    projectId,
                    actionableOnly: true,
                })
                const references = sanitizeReferences(
                    interactions?.find(
                        (row) =>
                            row.data?.references && Object.keys(row.data.references).length > 0,
                    )?.data?.references,
                )
                if (!references) {
                    throw new Error(
                        "This approval carries no workflow reference — answer on desktop.",
                    )
                }
                const invocationUrl = await resolveInvocationUrl({
                    projectId,
                    revisionId:
                        references.workflow_revision?.id ?? references.application_revision?.id,
                    workflowId: references.workflow?.id ?? references.application?.id,
                })
                if (!invocationUrl) {
                    throw new Error("Could not resolve the agent's invoke URL.")
                }
                const request = buildAgentResumeRequest({
                    invocationUrl,
                    references,
                    sessionId,
                    messages: stamped,
                    projectId,
                    applicationId: references.application?.id ?? undefined,
                })
                const response = await fetch(request.invocationUrl, {
                    method: "POST",
                    headers: {...request.headers, "Content-Type": "application/json"},
                    body: JSON.stringify(request.requestBody),
                    credentials: "include",
                })
                if (!response.ok) {
                    throw new Error(`Resume failed (HTTP ${response.status}).`)
                }
                // Fire-and-forget: drain the stream in the background so the browser doesn't
                // cancel the request; the run continues server-side regardless.
                void response.text().catch(() => undefined)
            } catch (err) {
                setPhase("error")
                setErrorText(err instanceof Error ? err.message : "Resume failed.")
            } finally {
                busyRef.current = false
            }
        },
        [sessionId, projectId],
    )

    const respond = useCallback(
        ({approvalId, approved}: {approvalId: string; approved: boolean}) => {
            void submit({approvalId}, approved)
        },
        [submit],
    )
    const approveAll = useCallback(() => {
        void submit({all: true}, true)
    }, [submit])

    return {phase, errorText, respond, approveAll}
}
