import {useRouter} from "next/router"

import {ChatScreen} from "@/features/chat/ChatScreen"

export default function SessionPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, session_id: sessionId} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof sessionId !== "string"
    ) {
        return null
    }
    return (
        <ChatScreen
            key={sessionId}
            sessionId={sessionId}
            projectId={projectId}
            workspaceId={workspaceId}
        />
    )
}
