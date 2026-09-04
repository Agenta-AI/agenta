import {useCallback, useMemo} from "react"

import {
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import type {SessionStream} from "@agenta/entities/session"
import {sessionRoutePath} from "@agenta/sessions/link"
import {sessionOpenTarget, type SessionRowVm} from "@agenta/sessions/row"
import {
    createSessionAutomationActions,
    mergeSessionMenuEntries,
    useSessionActions,
    type SessionActionTarget,
} from "@agenta/sessions-ui"
import {isToolsEnabled} from "@agenta/shared/api"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

const targetFor = (vm: SessionRowVm) => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
})

/** The standalone list renders raw stream rows, not the card list's view models. */
const targetForStream = (session: SessionStream) => ({
    sessionId: session.session_id,
    appId: sessionOpenTarget(session)?.appId ?? null,
    name: session.name,
    archived: Boolean(session.archived_at),
})

/**
 * The session row's context menu, bound to this app.
 *
 * The verbs are the SHARED ones — rename, pin, archive, delete, with their confirms — so a
 * session behaves the same here as on the desktop list. No local cache adapter: this app has no
 * open-tab store, so every action goes straight to the server.
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
    // Every session has its own page here, so no agent is needed for a link.
    const sharePathFor = useCallback(
        ({sessionId}: SessionActionTarget) => sessionRoutePath(base, sessionId),
        [base],
    )
    const actions = useSessionActions({sharePathFor})

    const open = useCallback(
        (vm: SessionRowVm) => void router.push(sessionRoutePath(base, vm.id)),
        [base, router],
    )

    // Automation verbs slot above the destructive divider — a trigger row IS its automation, so
    // those read first (#5927), exactly as the desktop list orders them.
    const menuFor = useCallback(
        (vm: SessionRowVm) =>
            mergeSessionMenuEntries(
                actions.menuItems(targetFor(vm), {onOpen: () => open(vm)}),
                automation.menuItems(vm),
            ),
        [actions, automation, open],
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
            actions.menuItems(targetForStream(session), {
                // The row IS a link — offering "Open" in its own menu restates the click.
            }),
        [actions],
    )

    const selectForStream = useCallback(
        (session: SessionStream, key: string) =>
            actions.onMenuClick(targetForStream(session))({key}),
        [actions],
    )

    return {open, menuFor, onMenuSelect, onRenameRow, entriesForStream, selectForStream}
}
