import {useCallback, useMemo} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {useT} from "@agenta/i18n"
import sessionsRowsCatalog from "@agenta/i18n/catalogs/sessions.rows"
import {
    InlineRenameInput,
    useInlineRename,
    useSessionActions,
    type SessionActionTarget,
} from "@agenta/sessions-ui"
import {Button} from "@agenta/ui/ui"
import {DotsThree} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {builderChatHref} from "../builder/builderChatHref"
import {SessionRowMenu} from "../sessions/SessionRowMenu"

const titleClass = "min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-colorText"

/**
 * The title of a saved builder chat and its "⋯" menu (B03). The menu holds the session actions a
 * session row has (rename, pin, copy link, archive, delete), from the shared `useSessionActions`
 * and the session row menu, because a builder chat is a session. Archive and delete leave for a
 * new chat.
 */
export const BuilderChatTitle = ({
    title,
    session,
    sessionId,
    workspaceId,
    projectId,
    userId,
}: {
    title: string
    /** The chat's session row, once read. */
    session: SessionStream | null | undefined
    sessionId: string
    workspaceId: string
    projectId: string
    userId: string | null
}) => {
    const t = useT(sessionsRowsCatalog)
    const router = useRouter()
    const sharePathFor = useCallback(
        ({sessionId: id}: SessionActionTarget) =>
            `${router.basePath}${builderChatHref({workspaceId, projectId, sessionId: id})}`,
        [projectId, router.basePath, workspaceId],
    )
    const onRemoved = useCallback(
        () => router.push(`/w/${workspaceId}/p/${projectId}/builder`),
        [projectId, router, workspaceId],
    )
    const actions = useSessionActions({sharePathFor, onRemoved, currentUserId: userId})
    const target = useMemo<SessionActionTarget>(
        () => ({
            sessionId,
            // The builder agent: no local tab cache holds it, so every verb goes to the server.
            appId: null,
            name: session?.name ?? null,
            archived: Boolean(session?.archived_at),
            ownerUserId: session?.owner_user_id ?? null,
        }),
        [session, sessionId],
    )
    const {commitRename} = actions
    const rename = useInlineRename({
        current: session?.name,
        onCommit: (name) => commitRename(target, name),
    })
    const actionsLabel = t("sessions.rows.actionsFor", {name: title})

    return (
        <>
            {rename.renaming ? (
                <InlineRenameInput
                    rename={rename}
                    ariaLabel={t("sessions.rows.sessionName")}
                    className={`${titleClass} rounded-[6px] border border-solid border-colorBorder bg-colorBgContainer px-1.5 py-0.5`}
                />
            ) : (
                <span className={titleClass}>{title}</span>
            )}
            <SessionRowMenu
                entries={actions.menuItems(target)}
                // "Rename" mounts the input once the menu has closed (the menu's deferred select).
                onSelect={(key) =>
                    key === "rename" ? rename.start : actions.onMenuClick(target)({key})
                }
                label={title}
                trigger={
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={actionsLabel}
                        title={actionsLabel}
                        className="shrink-0"
                    >
                        <DotsThree aria-hidden weight="bold" />
                    </Button>
                }
            />
        </>
    )
}
