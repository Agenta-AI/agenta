import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {ChatLoading} from "@/features/chat/states/ChatStates"

// The builder page loads on its own: no other route pays for it.
const BuilderPage = dynamic(
    () => import("@/features/builder-page/BuilderPage").then((m) => m.BuilderPage),
    {loading: () => <ChatLoading />},
)

/**
 * The builder page: `/builder` is a new chat, `/builder/{chatId}` one builder chat. One page file
 * for both, so the first message moves the address without a remount.
 */
export default function BuilderRoute() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, chat, tab} = router.query
    // `router.query` is empty on the first render of a hard load: show the loading state.
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return <ChatLoading />
    const chatId = Array.isArray(chat) && typeof chat[0] === "string" ? chat[0] : null
    return (
        <BuilderPage
            workspaceId={workspaceId}
            projectId={projectId}
            routeChatId={chatId}
            tab={typeof tab === "string" ? tab : undefined}
        />
    )
}
