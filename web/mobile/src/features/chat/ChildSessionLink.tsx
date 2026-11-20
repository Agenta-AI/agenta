import {fetchSessionStream} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import sessionsStatusCatalog from "@agenta/i18n/catalogs/sessions.status"
import {sessionRoutePath} from "@agenta/sessions/link"
import {useQuery} from "@tanstack/react-query"
import Link from "next/link"

/**
 * The child session a child update names, by its name, linked to its page. The update carries
 * only the session id, so the name is one small read of the child's stream row.
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
    const stream = useQuery({
        queryKey: ["child-session-name", projectId, sessionId],
        queryFn: ({signal}) =>
            fetchSessionStream({sessionId, projectId, abortSignal: signal, lowPriority: true}),
        staleTime: 60_000,
    })
    const name = stream.data?.name?.trim() || t("sessions.status.untitledSession")
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
