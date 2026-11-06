import {useRouter} from "next/router"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {useAppPageRedirect} from "@/features/developer/useAppPageRedirect"
import {VariantsScreen} from "@/features/variants/VariantsScreen"

export default function VariantsPage() {
    const router = useRouter()
    const moving = useAppPageRedirect("variants")
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId || moving) return null
    return (
        <DeveloperViewGate viewId="variants">
            <VariantsScreen workspaceId={workspaceId} projectId={projectId} />
        </DeveloperViewGate>
    )
}
