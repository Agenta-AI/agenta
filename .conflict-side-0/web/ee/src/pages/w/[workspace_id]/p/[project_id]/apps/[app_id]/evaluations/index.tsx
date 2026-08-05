import {memo} from "react"

import EvaluationsView from "@/oss/components/pages/evaluations/EvaluationsView"
import WorkflowPageTitle from "@/oss/components/PageTitle/WorkflowPageTitle"
import {useAppId} from "@/oss/hooks/useAppId"

const AppEvaluationsPage = () => {
    const appId = useAppId()
    return (
        <>
            <WorkflowPageTitle title="Evaluations" />
            <EvaluationsView scope="app" appId={appId} />
        </>
    )
}

export default memo(AppEvaluationsPage)
