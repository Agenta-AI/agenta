import {useRouter} from "next/router"

import {ChatScreen} from "@/features/chat/ChatScreen"

export default function SessionPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        session_id: sessionId,
        agent,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof sessionId !== "string"
    ) {
        return null
    }
    // NO `key={sessionId}`. It remounted the entire subtree on every session switch — including
    // AppShell, so the nav rail, the split geometry and the files pane were all torn down and
    // rebuilt to change which transcript is on screen. Everything per-session is already keyed by
    // sessionId (the revision pin, the executed-tool cache, the transcript query) or re-derives in
    // render (the poll cadence), so React can reconcile instead.
    return (
        <ChatScreen
            sessionId={sessionId}
            projectId={projectId}
            workspaceId={workspaceId}
            // A session Home just minted has no turns to name its agent — the link carries it.
            agentId={typeof agent === "string" && agent ? agent : undefined}
        />
    )
}
