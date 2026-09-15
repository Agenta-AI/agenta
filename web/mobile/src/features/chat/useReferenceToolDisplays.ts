import {useEffect} from "react"

import {referenceToolSkin, registerChatSkin} from "@agenta/chat/skin"
import {agentLatestRevisionAtomFamily} from "@agenta/entity-ui/agent"
import {useAtomValue} from "jotai"

/** Teach the tool-display registry this agent's own gateway tools, so their rows wear the app's logo. */
export const useReferenceToolDisplays = (agentId: string | null) => {
    const revision = useAtomValue(agentLatestRevisionAtomFamily(agentId ?? ""))
    const parameters = revision.data?.data?.parameters
    useEffect(() => {
        if (!parameters) return
        registerChatSkin(referenceToolSkin(parameters))
    }, [parameters])
}
