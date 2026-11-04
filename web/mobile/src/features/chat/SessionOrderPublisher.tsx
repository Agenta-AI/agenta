import {useMemo} from "react"

import {
    sessionTabScope,
    useSessionCardList,
    usePublishRenderedSessionTabs,
} from "@agenta/sessions/state"

/** Publishes the switcher's list order, which `Alt+1…9`, `Alt+Z/X` and leaving a session walk. */
export const SessionOrderPublisher = ({agentId}: {agentId?: string | null}) => {
    const {groups} = useSessionCardList({
        agentId: agentId ?? undefined,
        policy: {origin: "exclude-trigger", expansions: []},
        limit: 12,
        withPinned: true,
        lowPriority: true,
    })
    const ids = useMemo(() => groups.flatMap((group) => group.rows.map((vm) => vm.id)), [groups])
    usePublishRenderedSessionTabs(sessionTabScope(agentId), ids)
    return null
}
