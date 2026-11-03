import {useRouter} from "next/router"

import {MarketplaceScreen} from "@/features/marketplace/MarketplaceScreen"

export default function AgentTemplatesPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <MarketplaceScreen workspaceId={workspaceId} projectId={projectId} />
}
