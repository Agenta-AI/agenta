import {useRouter} from "next/router"

import {TemplatePageScreen} from "@/features/marketplace/TemplatePageScreen"

export default function TemplateDetailPage() {
    const router = useRouter()
    const {
        workspace_id: workspaceId,
        project_id: projectId,
        template_key: templateKey,
    } = router.query
    if (
        typeof workspaceId !== "string" ||
        typeof projectId !== "string" ||
        typeof templateKey !== "string"
    ) {
        return null
    }
    return (
        <TemplatePageScreen
            workspaceId={workspaceId}
            projectId={projectId}
            templateKey={templateKey}
        />
    )
}
