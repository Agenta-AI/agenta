import {useCallback} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

import {toSessionMenuEntries} from "../assets/menuEntries"

const actionTargetFor = (vm: SessionRowVm) => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
})

/**
 * This app's verbs for a shared session list: open a row in the playground, and the sessions-page
 * context menu. One definition, fed to every host of the shared `SessionListCard`.
 */
export const useSessionCardVerbs = () => {
    const openSession = useOpenAgentSession()
    const actions = useSessionActions()

    const onOpenRow = useCallback(
        (vm: SessionRowVm) => {
            if (vm.agentId)
                openSession({
                    appId: vm.agentId,
                    sessionId: vm.id,
                    title: vm.stream.name?.trim() || undefined,
                })
        },
        [openSession],
    )
    const menuFor = useCallback(
        (vm: SessionRowVm) =>
            toSessionMenuEntries(
                actions.menuItems(actionTargetFor(vm), {onOpen: () => onOpenRow(vm)}),
            ),
        [actions, onOpenRow],
    )
    const onMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) =>
            actions.onMenuClick(actionTargetFor(vm), {onOpen: () => onOpenRow(vm)})({key}),
        [actions, onOpenRow],
    )

    return {onOpenRow, menuFor, onMenuSelect}
}
