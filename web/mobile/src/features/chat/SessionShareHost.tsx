import {useCallback, useMemo, useState} from "react"

import {
    restrictSessionToOwnerAtom,
    revokeSessionGrantAtom,
    sessionSharingQueryAtomFamily,
    setSessionVisibilityAtom,
    sharingMembersQueryAtomFamily,
    upsertSessionGrantAtom,
    type SessionRole,
    type Visibility,
} from "@agenta/entities/sharing"
import {sessionRoutePath, shareUrl} from "@agenta/sessions/link"
import {
    SessionShareDialog,
    sharingWriteResultFromError,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
import {useDebounceInput} from "@agenta/shared/hooks"
import {userAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {copyToClipboard} from "@agenta/ui/utils"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useCurrentProject} from "../context/useCurrentProject"

import {shareDialogRequestAtom, type ShareDialogRequest} from "./shareDialogState"
import {useDisclosureProviderLabel} from "./useDisclosureProviderLabel"

/**
 * The one Share dialog of the app, for whichever session `shareDialogRequestAtom` names. Mounted
 * once beside the app's providers, so the tab strip and every row menu open the same dialog.
 */
export const SessionShareHost = () => {
    const [request, setRequest] = useAtom(shareDialogRequestAtom)
    if (!request) return null
    return (
        <SessionShareDialogBound
            key={request.sessionId}
            request={request}
            onClose={() => setRequest(null)}
        />
    )
}

/** Writes answer with the outcome the dialog reads; an API error never reaches it raw. */
const outcome = async (write: () => Promise<unknown>): Promise<SharingWriteResult> => {
    try {
        await write()
        return "ok"
    } catch (error) {
        return sharingWriteResultFromError(error)
    }
}

const SessionShareDialogBound = ({
    request,
    onClose,
}: {
    request: ShareDialogRequest
    onClose: () => void
}) => {
    const {sessionId, sessionName, workspaceId, projectId} = request
    const router = useRouter()
    const project = useCurrentProject(workspaceId, projectId)
    const me = useAtomValue(userAtom)

    const sharingQuery = useAtomValue(sessionSharingQueryAtomFamily(sessionId))
    const labels = useDisclosureProviderLabel(sharingQuery.data?.disclosure)
    const [search, setSearch] = useState("")
    // The picker queries as the person types, a beat behind them.
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const membersQuery = useAtomValue(sharingMembersQueryAtomFamily(search))
    // The first page names the owner and the grantees; the search page may not hold them.
    const everyoneQuery = useAtomValue(sharingMembersQueryAtomFamily(""))

    const upsert = useSetAtom(upsertSessionGrantAtom)
    const revoke = useSetAtom(revokeSessionGrantAtom)
    const setVisibility = useSetAtom(setSessionVisibilityAtom)
    const onlyMe = useSetAtom(restrictSessionToOwnerAtom)

    const people = useMemo<SharingPerson[]>(() => {
        const byId = new Map<string, SharingPerson>()
        for (const member of everyoneQuery.data?.members ?? []) byId.set(member.user_id, member)
        for (const member of membersQuery.data?.members ?? []) byId.set(member.user_id, member)
        if (me?.id && !byId.has(me.id)) {
            byId.set(me.id, {user_id: me.id, email: me.email, name: me.username || null})
        }
        return [...byId.values()]
    }, [everyoneQuery.data, membersQuery.data, me])

    const copyLink = useCallback(async () => {
        const link = shareUrl(
            `${router.basePath}${sessionRoutePath(`/w/${workspaceId}/p/${projectId}`, sessionId)}`,
        )
        if (link && (await copyToClipboard(link))) return true
        message.error("Couldn't copy the link")
        return false
    }, [projectId, router.basePath, sessionId, workspaceId])

    return (
        <SessionShareDialog
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
            sessionName={sessionName}
            projectName={project?.project_name ?? ""}
            sharing={sharingQuery.data?.sharing}
            disclosure={sharingQuery.data?.disclosure}
            providerLabel={labels.label}
            // The accounts are named by display name: the dialog waits for them like for the state.
            loading={sharingQuery.isPending || labels.pending}
            loadError={(sharingQuery.isError && !sharingQuery.data) || labels.failed}
            onRetry={() => {
                if (sharingQuery.isError) void sharingQuery.refetch()
                labels.retry()
            }}
            people={people}
            members={membersQuery.data?.members ?? []}
            membersSearch={typed}
            onMembersSearch={setTyped}
            membersLoading={membersQuery.isPending}
            membersError={membersQuery.isError}
            // One API call per invited person: the dialog calls this once for each.
            onUpsertGrant={(userId: string, role: SessionRole) =>
                outcome(() => upsert({sessionId, userId, role}))
            }
            onRevokeGrant={(userId: string) => outcome(() => revoke({sessionId, userId}))}
            onSetVisibility={(visibility: Visibility) =>
                outcome(() => setVisibility({sessionId, visibility}))
            }
            onOnlyMe={() => outcome(() => onlyMe({sessionId}))}
            onCopyLink={copyLink}
            onNotify={(text) => message.success(text)}
            // A 409: load the current state, then the dialog asks for the change again.
            onReload={() => void sharingQuery.refetch()}
        />
    )
}
