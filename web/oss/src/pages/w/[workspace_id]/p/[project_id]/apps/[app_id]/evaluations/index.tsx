import EvaluationsView from "@/oss/components/pages/evaluations/EvaluationsView"
import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {useAppId} from "@/oss/hooks/useAppId"

const AppEvaluationsPage = () => {
    const appId = useAppId()
    return (
        <RequireWorkflowKind allowed={["app"]} currentRoute="evaluations">
            <EvaluationsView scope="app" appId={appId} />
        </RequireWorkflowKind>
    )
}

export default AppEvaluationsPage
