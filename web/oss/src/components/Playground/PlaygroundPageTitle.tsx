import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {selectAgentChatTitlePart} from "@/oss/components/AgentChatSlice/assets/pageTitle"
import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {activeSessionTitleAtomFamily} from "@/oss/components/AgentChatSlice/state/sessions"
import PageTitle from "@/oss/components/PageTitle"
import {currentWorkflowContextAtom, playgroundEarlyAgentStateAtom} from "@/oss/state/workflow"

const PlaygroundPageTitle = ({onboarding}: {onboarding: boolean}) => {
    const scope = useChatScopeKey()
    const workflowContext = useAtomValue(currentWorkflowContextAtom)
    const workflowName = workflowContext.workflow?.name || workflowContext.workflow?.slug
    const earlyAgentState = useAtomValue(playgroundEarlyAgentStateAtom)
    const activeSessionTitle = useAtomValue(
        useMemo(() => activeSessionTitleAtomFamily(scope), [scope]),
    )

    if (onboarding) return <PageTitle title="Home" />
    // Nothing named yet: render no title so the app default stands instead of flapping to it.
    if (!workflowName) return null

    if (earlyAgentState === "agent") {
        return (
            <PageTitle
                title={selectAgentChatTitlePart({
                    agentName: workflowName,
                    sessionTitle: activeSessionTitle.title,
                    firstUserMessage: activeSessionTitle.firstUserMessage,
                })}
            />
        )
    }

    return <PageTitle title="Playground" context={workflowName} />
}

export default PlaygroundPageTitle
