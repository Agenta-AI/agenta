import {useRouter} from "next/router"

import {SkillCreateScreen} from "@/features/skills/SkillCreateScreen"

export default function NewSkillPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return null
    return <SkillCreateScreen workspaceId={workspaceId} projectId={projectId} />
}
