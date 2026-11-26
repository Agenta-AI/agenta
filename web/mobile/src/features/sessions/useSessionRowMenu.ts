import {useCallback, useMemo} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import type {SessionStream} from "@agenta/entities/session"
import {sharingMembersQueryAtomFamily} from "@agenta/entities/sharing"
import {sessionRoutePath} from "@agenta/sessions/link"
import {sessionOpenTarget, type SessionRowVm} from "@agenta/sessions/row"
import {
    createSessionAutomationActions,
    mergeSessionMenuEntries,
    sessionMenuAccess,
    useSessionActions,
    type SessionActionTarget,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {personName, type SharingPerson} from "@agenta/sessions-ui/sharing"
import {isToolsEnabled} from "@agenta/shared/api"
import {userAtom} from "@agenta/shared/state"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {sharingCopy} from "@/lib/sharingCopy"

import {shareDialogRequestAtom} from "../chat/shareDialogState"
import {useLeaveSession} from "../chat/useLeaveSession"

const targetFor = (vm: SessionRowVm) => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
    ownerUserId: vm.stream.owner_user_id ?? null,
})

/** The standalone list renders raw stream rows, not the card list's view models. */
const targetForStream = (session: SessionStream) => ({
    sessionId: session.session_id,
    appId: sessionOpenTarget(session)?.appId ?? null,
    name: session.name,
    archived: Boolean(session.archived_at),
    ownerUserId: session.owner_user_id ?? null,
})

/** The first members page, read only where a row menu has to name an owner (a phone). */
const noMembersAtom = atom<{data?: {members: SharingPerson[]}}>({})

/**
 * The session row's context menu, bound to this app.
 *
 * The verbs are the SHARED ones — rename, pin, archive, delete, with their confirms — so a
 * session behaves the same here as on the desktop list. No local cache adapter: every action goes
 * straight to the server, and the open-tab set only learns of it afterwards (`useLeaveSession`).
 */
export const useSessionRowMenu = (base: string) => {
    const router = useRouter()
    // The automation verbs — "Open automation", "View delivery" — from the same shared factory the
    // desktop sessions page uses. They only appear on trigger-created rows, so a list that
    // excludes those never shows them. `SessionAutomationDrawers` is what they open.
    const openSchedule = useSetAtom(triggerScheduleDrawerAtom)
    const openSubscription = useSetAtom(triggerSubscriptionDrawerAtom)
    const openDelivery = useSetAtom(triggerDeliveriesDrawerAtom)
    const automation = useMemo(
        () =>
            createSessionAutomationActions(isToolsEnabled(), {
                openSchedule,
                openSubscription,
                openDelivery,
            }),
        [openDelivery, openSchedule, openSubscription],
    )
    // Every session has its own page here, so no agent is needed for a link. The app's `/m`
    // prefix is part of it: without it the link opened the old app.
    const sharePathFor = useCallback(
        ({sessionId}: SessionActionTarget) =>
            `${router.basePath}${sessionRoutePath(base, sessionId)}`,
        [base, router.basePath],
    )
    const me = useAtomValue(userAtom)
    const openShare = useSetAtom(shareDialogRequestAtom)
    const onShare = useCallback(
        (target: SessionActionTarget) => {
            const [, , workspaceId = "", , projectId = ""] = base.split("/")
            openShare({
                sessionId: target.sessionId,
                sessionName: target.name ?? "",
                workspaceId,
                projectId,
                agentId: target.appId,
            })
        },
        [base, openShare],
    )
    // Archiving or deleting the session you are on has to move you off it.
    const actions = useSessionActions({
        sharePathFor,
        onRemoved: useLeaveSession(base),
        currentUserId: me?.id ?? null,
        onShare,
    })

    // A phone has no tooltip to explain the verbs that are missing, so the menu says it.
    const phone = useAtomValue(phoneViewportAtom)
    const members = useAtomValue(phone ? sharingMembersQueryAtomFamily("") : noMembersAtom)
    const withOwnerNote = useCallback(
        (entries: SessionMenuEntry[], target: SessionActionTarget): SessionMenuEntry[] => {
            if (!phone || sessionMenuAccess(target, me?.id) !== "member") return entries
            const owner = members.data?.members.find(
                (member) => member.user_id === target.ownerUserId,
            )
            return [
                ...entries,
                {type: "divider" as const},
                {
                    key: "sharing-owner-note",
                    label: sharingCopy.rowMenuNotOwner(
                        personName(owner) || sharingCopy.ownerFallback,
                    ),
                    disabled: true,
                },
            ]
        },
        [me?.id, members.data, phone],
    )

    const open = useCallback(
        (vm: SessionRowVm) => void router.push(sessionRoutePath(base, vm.id)),
        [base, router],
    )

    // Automation verbs slot above the destructive divider — a trigger row IS its automation, so
    // those read first (#5927), exactly as the desktop list orders them.
    const menuFor = useCallback(
        (vm: SessionRowVm) =>
            withOwnerNote(
                mergeSessionMenuEntries(
                    actions.menuItems(targetFor(vm), {onOpen: () => open(vm)}),
                    automation.menuItems(vm),
                ),
                targetFor(vm),
            ),
        [actions, automation, open, withOwnerNote],
    )

    const onMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) => {
            if (automation.onSelect(vm, key)) return
            actions.onMenuClick(targetFor(vm), {onOpen: () => open(vm)})({key})
        },
        [actions, automation, open],
    )

    // Rename happens IN the row; the hook only supplies the commit.
    const onRenameRow = useCallback(
        (vm: SessionRowVm, name: string) => actions.commitRename(targetFor(vm), name),
        [actions],
    )

    const entriesForStream = useCallback(
        (session: SessionStream) =>
            withOwnerNote(
                actions.menuItems(targetForStream(session), {
                    // The row IS a link — offering "Open" in its own menu restates the click.
                }),
                targetForStream(session),
            ),
        [actions, withOwnerNote],
    )

    const selectForStream = useCallback(
        (session: SessionStream, key: string) =>
            actions.onMenuClick(targetForStream(session))({key}),
        [actions],
    )

    return {open, menuFor, onMenuSelect, onRenameRow, entriesForStream, selectForStream}
}
