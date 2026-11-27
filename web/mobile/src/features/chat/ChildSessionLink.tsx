import {useT} from "@agenta/i18n"
import chatQueuedMessagesDockCatalog from "@agenta/i18n/catalogs/chat.queuedMessagesDock"
import sessionsStatusCatalog from "@agenta/i18n/catalogs/sessions.status"
import {sessionRoutePath} from "@agenta/sessions/link"
import Link from "next/link"

import {useSessionHeader} from "./useSessionHeader"

/**
 * The child session a child update names, by its name, linked to its page. The update carries
 * only the session id, so the name comes from the child's stream row, through the same cache that
 * renames and session changes update. Until the row reads (or while its read fails and the
 * header poll retries it), the link says "Update from another session"; "Untitled session" is only
 * for a child that has no name.
 */
export const ChildSessionLink = ({
    sessionId,
    projectId,
    base,
}: {
    sessionId: string
    projectId: string
    /** `/w/:workspace/p/:project` */
    base: string
}) => {
    const t = useT(sessionsStatusCatalog)
    const tDock = useT(chatQueuedMessagesDockCatalog)
    const header = useSessionHeader(projectId, sessionId)
    // `undefined` until a read answers; a later failed read keeps the last name.
    const name =
        header.data === undefined
            ? tDock("chat.queuedMessagesDock.childUpdateFrom")
            : header.data?.name?.trim() || t("sessions.status.untitledSession")
    return (
        <Link
            href={sessionRoutePath(base, sessionId)}
            title={name}
            className="text-foreground underline-offset-2 hover:underline"
        >
            {name}
        </Link>
    )
}
