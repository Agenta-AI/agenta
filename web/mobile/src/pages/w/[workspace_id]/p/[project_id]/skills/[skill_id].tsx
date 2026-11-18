import {useRouter} from "next/router"

import {SkillPageScreen} from "@/features/skills/SkillPageScreen"

export default function SkillPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, skill_id: skillId} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof skillId !== "string"
    )
        return null
    return <SkillPageScreen workspaceId={workspaceId} projectId={projectId} skillId={skillId} />
}
