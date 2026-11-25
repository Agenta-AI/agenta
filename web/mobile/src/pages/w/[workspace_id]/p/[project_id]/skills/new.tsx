import {useRouter} from "next/router"

import {SkillCreateScreen} from "@/features/skills/SkillCreateScreen"

export default function NewSkillPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    return <SkillCreateScreen workspaceId={workspaceId} projectId={projectId} />
}
