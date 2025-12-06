import EvaluationsView from "@/oss/components/pages/evaluations/EvaluationsView"
import {useAppId} from "@/oss/hooks/useAppId"

const AppEvaluationsPage = () => {
    const appId = useAppId()
    return <EvaluationsView scope="app" appId={appId} />
}

export default AppEvaluationsPage
