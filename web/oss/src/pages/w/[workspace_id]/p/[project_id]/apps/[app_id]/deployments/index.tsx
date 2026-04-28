import {useEffect, useRef} from "react"

import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {appIdentifiersAtom} from "@/oss/state/appState"

/**
 * Deployments page → variants page redirect for APP workflows.
 *
 * Replaces the previous `getServerSideProps` permanent-redirect (Phase 2 design
 * decision: client-side guard for consistency with the other 3 disabled-for-
 * evaluator routes). For evaluator workflows, the wrapping `RequireWorkflowKind`
 * fires `useWorkflowRouteGuard` which redirects to the evaluator's playground
 * via `resolveWorkflowDestination` — single mechanism, single navigation.
 */
function DeploymentsAppRedirect() {
    const router = useRouter()
    const {workspaceId, projectId, appId} = useAtomValue(appIdentifiersAtom)
    const redirected = useRef(false)

    useEffect(() => {
        if (redirected.current) return
        if (!workspaceId || !projectId || !appId) return
        redirected.current = true
        router.replace(
            `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}/variants?tab=deployments`,
        )
    }, [workspaceId, projectId, appId, router])

    return (
        <div className="flex items-center justify-center w-full h-full min-h-[240px]">
            <Spin />
        </div>
    )
}

const DeploymentsRedirectPage = () => (
    <RequireWorkflowKind allowed={["app"]} currentRoute="deployments">
        <DeploymentsAppRedirect />
    </RequireWorkflowKind>
)

export default DeploymentsRedirectPage
