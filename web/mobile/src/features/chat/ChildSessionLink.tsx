import {useT} from "@agenta/i18n"
import sessionsStatusCatalog from "@agenta/i18n/catalogs/sessions.status"
import {sessionRoutePath} from "@agenta/sessions/link"
import Link from "next/link"

import {useSessionHeader} from "./useSessionHeader"

/**
 * The child session a child update names, by its name, linked to its page. The update carries
 * only the session id, so the name comes from the child's stream row, through the same cache that
 * renames and session changes update.
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
    const header = useSessionHeader(projectId, sessionId)
    const name = header.data?.name?.trim() || t("sessions.status.untitledSession")
    return (
        <Link
            href={sessionRoutePath(base, sessionId)}
            title={name}
            className="text-colorText underline-offset-2 hover:underline"
        >
            {name}
        </Link>
    )
}
