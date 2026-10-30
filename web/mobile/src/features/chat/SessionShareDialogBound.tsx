import {useCallback, useMemo, useState} from "react"

import {hasUserItems} from "@agenta/entities/accountChoice"
import {
    restrictSessionToOwnerAtom,
    revokeSessionGrantAtom,
    sessionSharingQueryAtomFamily,
    setSessionVisibilityAtom,
    sharingMemberRosterQueryAtom,
    sharingMembersQueryAtomFamily,
    upsertSessionGrantAtom,
    type SessionRole,
    type Visibility,
} from "@agenta/entities/sharing"
import {
    retrievedWorkflowRevisionFamilyKey,
    retrievedWorkflowRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
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
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useCurrentProject} from "../context/useCurrentProject"

import type {ShareDialogRequest} from "./shareDialogState"
import {useDisclosureProviderLabel} from "./useDisclosureProviderLabel"

/** Writes answer with the outcome the dialog reads; an API error never reaches it raw. */
const outcome = async (write: () => Promise<unknown>): Promise<SharingWriteResult> => {
    try {
        await write()
        return "ok"
    } catch (error) {
        return sharingWriteResultFromError(error)
    }
}

export const SessionShareDialogBound = ({
    request,
    onClose,
}: {
    request: ShareDialogRequest
    onClose: () => void
}) => {
    const {sessionId, sessionName, workspaceId, projectId, agentId} = request
    const router = useRouter()
    const project = useCurrentProject(workspaceId, projectId)
    const me = useAtomValue(userAtom)

    const sharingQuery = useAtomValue(sessionSharingQueryAtomFamily(sessionId))
    // The agent's configuration says whether it uses each person's own accounts (contract
    // section 13, item 16): no record says which turn used one.
    // The agent ref reads its latest revision, as the automation notice does.
    const agentRevision = useAtomValue(
        retrievedWorkflowRevisionQueryAtomFamily(
            retrievedWorkflowRevisionFamilyKey(agentId ? {workflow: {id: agentId}} : null),
        ),
    )
    const usesPersonalAccounts = useMemo(
        () => hasUserItems(agentRevision.data?.parameters?.agent),
        [agentRevision.data],
    )
    const labels = useDisclosureProviderLabel(sharingQuery.data?.disclosure)
    const [search, setSearch] = useState("")
    // The picker queries as the person types, a beat behind them.
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const membersQuery = useAtomValue(sharingMembersQueryAtomFamily(search))
    // Every page of the project's members names the owner and the grantees; neither the
    // picker's first page (50 people) nor the search page may hold them.
    const rosterQuery = useAtomValue(sharingMemberRosterQueryAtom)

    const upsert = useSetAtom(upsertSessionGrantAtom)
    const revoke = useSetAtom(revokeSessionGrantAtom)
    const setVisibility = useSetAtom(setSessionVisibilityAtom)
    const onlyMe = useSetAtom(restrictSessionToOwnerAtom)

    const people = useMemo<SharingPerson[]>(() => {
        const byId = new Map<string, SharingPerson>()
        for (const member of rosterQuery.data ?? []) byId.set(member.user_id, member)
        for (const member of membersQuery.data?.members ?? []) byId.set(member.user_id, member)
        if (me?.id && !byId.has(me.id)) {
            byId.set(me.id, {user_id: me.id, email: me.email, name: me.username || null})
        }
        return [...byId.values()]
    }, [rosterQuery.data, membersQuery.data, me])

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
            // A failed re-read is a load error too, with the last state in hand: no write acts on it.
            loading={sharingQuery.isPending || labels.pending}
            loadError={sharingQuery.isError || labels.failed}
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
            usesPersonalAccounts={usesPersonalAccounts}
        />
    )
}
