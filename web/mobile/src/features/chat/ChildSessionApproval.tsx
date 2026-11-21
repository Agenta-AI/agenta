import {useEffect, useMemo, useRef} from "react"

import type {PendingApproval} from "@agenta/chat/model"
import {richText, useT} from "@agenta/i18n"
import chatMobileApprovalCatalog from "@agenta/i18n/catalogs/chat.mobileApproval"
import {actionableInteractionsQueryKey} from "@agenta/sessions/state"
import {useQueryClient} from "@tanstack/react-query"

import {sharingCopy} from "@/lib/sharingCopy"

import {ApprovalDock} from "./ApprovalDock"
import {ChildSessionLink} from "./ChildSessionLink"
import {sessionReadOnlyReason} from "./sessionReadOnly"
import {useApprovalActions} from "./useApprovalActions"
import {useSessionSharing} from "./useSessionSharing"

/**
 * The pending approval of a child session, in the chat of the session that created it. The card
 * is the child's own (`ApprovalDock`), under a line that names and links the child, so a person
 * does not approve another agent's call by mistake. The answer goes to the CHILD's interaction
 * through the respond route with the person's own login, so the child continues.
 *
 * Who may answer is the child session's rule, read from the child's own row: until it is known,
 * and for a reader who cannot send there, the card shows read-only. It binds no keyboard
 * shortcut, so a key press in this chat answers only this chat's own card.
 */
export const ChildSessionApproval = ({
    sessionId,
    approvals,
    projectId,
    workspaceId,
    bottomMost,
}: {
    /** The child session that asks. */
    sessionId: string
    approvals: PendingApproval[]
    projectId: string
    workspaceId: string
    bottomMost: boolean
}) => {
    const t = useT(chatMobileApprovalCatalog)
    const queryClient = useQueryClient()
    const {query, sharing, ownerName} = useSessionSharing(sessionId, projectId)
    const pendingApprovalIds = useMemo(
        () => approvals.map((approval) => approval.approvalId),
        [approvals],
    )
    const actions = useApprovalActions({sessionId, projectId, pendingApprovalIds})

    const known = Boolean(sharing) && !query.isError
    const reason = sessionReadOnlyReason({
        sharing,
        agentHidden: sharing?.agent_hidden === true,
    })
    const canAnswer = known && !reason
    const readOnlyNote = reason
        ? sharingCopy.approvalWaiting(ownerName || sharingCopy.ownerFallback)
        : null

    // This chat watches only its own session, so nothing else tells the project's actionable
    // interactions that the child's gate moved on: re-read them once a submit settles.
    const phaseRef = useRef(actions.phase)
    useEffect(() => {
        const previous = phaseRef.current
        phaseRef.current = actions.phase
        if (previous === "resuming" && actions.phase !== "resuming") {
            void queryClient.invalidateQueries({
                queryKey: actionableInteractionsQueryKey(projectId),
            })
        }
    }, [actions.phase, projectId, queryClient])

    return (
        <ApprovalDock
            approvals={approvals}
            actions={actions}
            bottomMost={bottomMost}
            readOnly={!canAnswer}
            readOnlyNote={readOnlyNote}
            shortcuts={false}
            heading={richText(t("chat.mobileApproval.childSessionAsks"), {
                link: () => (
                    <ChildSessionLink
                        sessionId={sessionId}
                        projectId={projectId}
                        base={`/w/${workspaceId}/p/${projectId}`}
                    />
                ),
            })}
        />
    )
}
