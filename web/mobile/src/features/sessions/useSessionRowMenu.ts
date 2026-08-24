import {useCallback} from "react"

import type {SessionStream} from "@agenta/entities/session"
import {sessionOpenTarget, type SessionRowVm} from "@agenta/sessions/row"
import {useSessionActions} from "@agenta/sessions-ui"
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
    const actions = useSessionActions()

    const open = useCallback(
        (vm: SessionRowVm) => void router.push(`${base}/sessions/${vm.id}`),
        [base, router],
    )

    const menuFor = useCallback(
        (vm: SessionRowVm) => actions.menuItems(targetFor(vm), {onOpen: () => open(vm)}),
        [actions, open],
    )

    const onMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) =>
            actions.onMenuClick(targetFor(vm), {onOpen: () => open(vm)})({key}),
        [actions, open],
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

    return {open, menuFor, onMenuSelect, entriesForStream, selectForStream}
}
