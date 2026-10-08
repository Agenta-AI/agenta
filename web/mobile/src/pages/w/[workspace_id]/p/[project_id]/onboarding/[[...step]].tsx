import {useRouter} from "next/router"

import {OnboardingFlowScreen} from "@/features/onboarding/OnboardingFlowScreen"
import {OnboardingFlowSkeleton} from "@/features/onboarding/states/OnboardingFlowSkeleton"

// `/m/w/:workspace_id/p/:project_id/onboarding[/<step>]` — the first-agent flow; the step is the path.
export default function OnboardingPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    if (!workspaceId || !projectId) return <OnboardingFlowSkeleton />
    return <OnboardingFlowScreen workspaceId={workspaceId} projectId={projectId} />
}
