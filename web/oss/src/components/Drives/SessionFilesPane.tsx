import {
    useSessionFilesPane as usePaneShared,
    SessionFilesPane as SessionFilesPaneView,
} from "@agenta/entity-ui/drive"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"

/** OSS binding: the shared pane keyed by this app's chat scope. */
export const useSessionFilesPane = (sessionId: string) => usePaneShared(useChatScopeKey(), sessionId)

export function SessionFilesPane({sessionId}: {sessionId: string}) {
    return <SessionFilesPaneView scope={useChatScopeKey()} sessionId={sessionId} />
}
