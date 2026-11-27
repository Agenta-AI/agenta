import {useRouter} from "next/router"

import {SkillPageScreen} from "@/features/skills/SkillPageScreen"

export default function SkillPage() {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId, skill_slug: skillSlug} = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof skillSlug !== "string"
    ) {
        return null
    }
    return (
        <SkillPageScreen
            key={skillSlug}
            workspaceId={workspaceId}
            projectId={projectId}
            skillSlug={skillSlug}
        />
    )
}
