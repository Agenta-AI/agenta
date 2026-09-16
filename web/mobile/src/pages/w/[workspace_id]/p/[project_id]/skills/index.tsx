import {useRouter} from "next/router"

import {SkillListScreen} from "@/features/skills/SkillListScreen"

export default function SkillsPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <SkillListScreen workspaceId={workspaceId} projectId={projectId} />
}
